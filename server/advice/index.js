'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT («Мнение Лиса»).
 *
 * Владелец 26.09: прежние правила приучили модель к шаблонам «показатель упал — сделайте базовое
 * действие»: банальные советы и одно и то же по кругу. Теперь функция ничего не решает за модель:
 * - модель получает сырой JSON — ряды чисел по дням за неделю и по часам за сегодня, профиль,
 *   что Лис уже говорил и какие микро-действия уже предлагал (`previously_suggested_actions`);
 * - системный запрос (`SYSTEM_PROMPT`) описывает только ход рассуждения: найти свою норму по рядам,
 *   аномалии и расхождения трендов, гипотезу о механизме, и одно прикладное микро-действие.
 *   Связок «если X — сделай Y» и примеров с показателями в нём нет;
 * - функция лишь проверяет ответ (`answerProblem`): ровно два предложения, в первом нет цифр, нет
 *   банальностей и запретных слов, действие не повторяет прежние. Не прошёл — один повтор с причиной;
 *   и он мимо — 502, в приложении шаблонный совет.
 *
 * Ключей API здесь нет: функция ходит в YandexGPT от имени своего сервисного аккаунта
 * (роль ai.languageModels.user), токен выдаёт платформа (context.token). Яндексу передаётся
 * x-data-logging-enabled: false. Сама функция ничего не хранит и тело запроса в лог не пишет.
 *
 * Переменные окружения: FOLDER_ID — каталог; APP_KEY — тот же ключ, что EXPO_PUBLIC_ADVICE_KEY;
 * MODEL — необязательно: yandexgpt (по умолчанию, Pro), yandexgpt-lite или aliceai-llm.
 * Среда выполнения — Node.js 22, точка входа — index.handler.
 */

const { Buffer } = require('node:buffer');

const API_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
/** Версия кода — в каждом ответе (`v`): по ней приложение видит, что в Yandex Cloud свежий код. */
const VERSION = 6;
const MAX_BODY_CHARS = 16000;
const LLM_TIMEOUT_MS = 12000;
/** Сколько функция готова ждать модель в сумме: приложение ждёт ответ 15 с. */
const DEADLINE_MS = 13000;
/** Меньше этого на повтор не остаётся — не пробуем. */
const RETRY_MIN_MS = 4000;
const TEMPERATURE = 0.8;

const MODE_TEXT = { morning: 'утро, после пробуждения', day: 'день', evening: 'вечер, перед сном' };
const SLOT_WHEN = { morning: 'утром', day: 'днём', evening: 'вечером' };
const GOAL_TEXT = { lose: 'снизить вес', keep: 'поддерживать форму', gain: 'набрать мышечную массу' };
const SEX_TEXT = { male: 'мужчина', female: 'женщина' };
const WORKOUT_TEXT = { cardio: 'кардио', strength: 'силовая' };

/**
 * Системный запрос (владелец 26.09, третья версия): в запросе НЕТ готовых действий — ЯндексGPT
 * копировал их слово в слово; направления заданы абстрактно. Первое предложение обязано опираться
 * на тренд датчиков кольца за последние часы (пульс, шаги, фон напряжения) — без цифр, но не
 * «гороскоп» («вы устали»). Ответ — до 130 символов, ровно два предложения.
 */
const SYSTEM_PROMPT = `Ты — Лис из приложения Vuelo к умному кольцу. Кольцо весь день снимает пульс, шаги и фон напряжения. Ты коротко говоришь человеку, что датчики видят прямо сейчас, и предлагаешь одно действие. Обращайся на «вы».

На входе JSON:
- current_time — текущее местное время;
- person — пол, возраст, цель;
- days — ряды по дням (ago: 0 — сегодня): сон, пульс во сне, пульс покоя, вариабельность, стресс днём, шаги и личная норма, время приёмов пищи; null — данных нет;
- today_by_hour — сегодня по часам, начиная с from_hour: steps — шаги, stress — фон напряжения от 0 до 100, pulse — средний пульс; null — замера не было;
- previously_suggested_actions — что ты уже советовал.

Как думать (про себя, в ответ не пиши):
1. Возьми последние два-четыре часа today_by_hour и сравни их с тем, что обычно для этого человека: с его прошлыми днями, пульсом покоя и его же утром сегодня.
2. Найди один настоящий тренд: как пульс, движение и фон напряжения меняются относительно друг друга и во времени — что растёт, что держится, чего не хватает.
3. Первое предложение — этот тренд словами о теле: какой датчик что показывает и за какое время. Без чисел и процентов, но так, чтобы было ясно: это данные кольца, а не догадка о настроении.
4. Второе предложение — одно простое действие взрослого человека на полминуты, выполнимое за рабочим столом, в транспорте или на ходу, не привлекая внимания. Ищи его в одном из направлений: эргономика позы и рабочего места, микроразминка кистей, шеи или плечевого пояса, смена зрительной дистанции, терморегуляция и свежий воздух, темп движения. Сформулируй конкретное действие сам, под найденный тренд, и не повторяй previously_suggested_actions.

Время суток:
- до 12:00 — мягкий разгон дня;
- с 12:00 до 20:00 — удержать фокус, разгрузить шею и глаза, снять фоновый зажим; ночной сон не упоминай;
- с 20:00 и ночью — подготовка к отдыху: свет и экраны.

Нельзя:
- ярлыки настроения вместо данных: «вы устали», «вы напряжены», «вы сосредоточены»;
- дыхательные упражнения: вдохи, выдохи, «подышите»;
- сюсюканье и странные прикосновения к себе: погладить, обнять себя, массировать лицо или щёки;
- эзотерика, точки на теле, йога, медитации, практики лёжа или на полу;
- цифры и проценты в первом предложении; заумные и медицинские слова, диагнозы, врачи, обещания результата; слова «глюкоза», «сахар», «давление»; другие приложения и бренды;
- приветствия, вопросы, списки, эмодзи, кавычки.

Ответ — не длиннее 130 символов, ровно два предложения: тренд по датчикам за последние часы и одно действие в повелительном наклонении. Больше ничего не пиши.`;

// ── Вход модели: сырой JSON ─────────────────────────────────────────────────────────────────────

/** Предложения текста: по точке, восклицательному или вопросительному знаку и многоточию. */
const sentences = (text) =>
  String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z«"])/)
    .map((x) => x.trim())
    .filter(Boolean);

/** «сегодня утром», «вчера вечером», «3 дня назад днём». */
function whenText(ago, slot) {
  const day = ago === 0 ? 'сегодня' : ago === 1 ? 'вчера' : `${ago} дн. назад`;
  return `${day} ${SLOT_WHEN[slot]}`;
}

/**
 * Что Лис уже говорил: `past_opinions` приложения (неделя) или, у старых сборок, три строки `recent`
 * («сегодня утром — …»). Действие — последнее предложение мнения.
 */
function pastOf(p) {
  const list = Array.isArray(p.past_opinions) && p.past_opinions.length
    ? p.past_opinions.map((o) => ({ when: whenText(o.ago, o.slot), text: o.text }))
    : p.recent.map((line) => {
        const lead = /^(.+?) — /.exec(line);
        return { when: lead ? lead[1] : '', text: lead ? line.slice(lead[0].length) : line };
      });
  return list.map((o) => {
    const parts = sentences(o.text);
    return { ...o, action: parts.length > 1 ? parts[parts.length - 1] : null };
  });
}

/** JSON для модели: текущее время, ряды как есть и уже данные советы. */
function modelInput(p) {
  const pr = p.profile;
  const days = [...p.days]
    .sort((a, b) => b.ago - a.ago)
    .map((d) => ({
      ago: d.ago,
      asleep: d.asleep,
      awake: d.awake,
      sleep_min: d.sleepMin,
      deep_min: d.deepMin,
      night_pulse: d.nightPulse,
      resting_pulse: d.restingPulse,
      hrv_ms: d.hrv,
      day_stress: d.stress,
      steps: d.steps,
      step_norm: d.stepNorm,
      workout: d.workout ? WORKOUT_TEXT[d.workout] : null,
      meal_times: d.meals,
    }));
  const h = p.hours;
  return {
    current_time: p.time,
    person: { sex: pr.sex ? SEX_TEXT[pr.sex] : null, age: pr.age, goal: pr.goal ? GOAL_TEXT[pr.goal] : null },
    days,
    today_by_hour: h
      ? {
          from_hour: h.from,
          steps: h.steps,
          stress: Array.isArray(h.stress) ? h.stress : null,
          pulse: Array.isArray(h.pulse) ? h.pulse : null,
        }
      : null,
    previously_suggested_actions: pastOf(p).filter((o) => o.action).map((o) => o.action),
  };
}

// ── Проверка ответа ─────────────────────────────────────────────────────────────────────────────

const ANSWER_MIN_CHARS = 30;
/** Плашка на главном экране маленькая: длиннее текст обрезается на полуслове (владелец 26.09). */
const ANSWER_MAX_CHARS = 130;

/** Дыхательные практики — под полным запретом: модель предлагала их через раз (владелец 26.09). */
const BREATHING = [/вдох/, /выдох/, /дыхани/, /дыхательн/, /подыш/, /дышите/];
/** Эзотерика и сложные телесные практики — человек в офисе, транспорте, на учёбе. */
const ESOTERIC = [/чакр/, /акупунктур/, /энергетическ/, /точк\S* на (стоп|ладон|ушах|ухе)/, /йог/, /асан/, /медитац/, /мантр/, /лёжа/, /лежа/, /на полу/];
/** Заумь вместо живого языка. */
const JARGON = [/нестабильн/, /сбо[йиею]/, /восстановлени\S* организм/, /циркадн/, /парасимпат/, /симпатическ/, /кортизол/];
/** Ярлыки настроения вместо данных кольца — «гороскоп» (владелец 26.09). */
const HOROSCOPE = [/вы (слишком |очень |немного )?(устал|напряж|сосредоточ|перегруж|вымотал)/];
/** Сюсюканье и странные прикосновения к себе. */
const TOUCHY = [/поглад/, /обним/, /помассир/, /массаж/, /потрогайте/];
/** Первое предложение — про датчики: пульс, движение, нагрузку или фон напряжения. */
const RING_WORDS = /(пульс|сердц|шаг|движени|двигал|активност|нагрузк|фон|напряжени|стресс|сидит|сидите|сидели|без движения|ритм)/;
/** Днём (12:00–20:00) про ночной сон не говорим: совет — про здесь и сейчас. */
// \b в JavaScript не работает с кириллицей — границы слова вручную.
const NIGHT_TALK = [/ноч/, /(^|[^а-яё])(сон|сна|сном|сне)([^а-яё]|$)/, /поспал/, /выспал/, /недосып/];
const DAY_FROM = 12 * 60;
const EVENING_FROM = 20 * 60;
/** Правила продукта: без диагнозов, медицины, выводов по глюкозе и давлению, обещаний и чужих брендов. */
const FORBIDDEN = [
  /диагноз/, /болезн/, /заболева/, /диабет/, /гипергликем/, /гипогликем/, /гипертон/, /гипотон/, /лечени/, /лекарств/,
  /таблетк/, /врач/, /доктор/, /глюкоз/, /сахар/, /давлени/, /гарантир/, /ожирен/,
  /whoop/, /oura/, /garmin/, /apple/, /yandex/, /яндекс/, /алиса/, /gpt/,
];
/** Общие слова, по которым действия похожими не считаются. */
const COMMON = new Set(['прямо', 'сейча', 'секун', 'минут', 'затем', 'потом', 'несколько', 'сдела']);
const stems = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-zа-яё]+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5))
      .filter((w) => !COMMON.has(w)),
  );
/** Действие похоже на прежнее: большая часть значимых слов совпадает. */
const REPEAT_SHARE = 0.6;
function similar(a, b) {
  const x = stems(a);
  const y = stems(b);
  if (!x.size || !y.size) return false;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.min(x.size, y.size) >= REPEAT_SHARE;
}

/** Текст ответа: без «Лис:» в начале, кавычек вокруг и лишних пробелов. */
function cleanAnswer(raw) {
  return String(raw)
    .replace(/\*/g, '')
    .replace(/^\s*(Лис|Ответ)\s*:\s*/i, '')
    .replace(/^["«„“]+|["»“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const minuteOf = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Что не так с ответом: null — годится. `time` — текущее «ЧЧ:ММ». */
function answerProblem(text, previousActions = [], time = '15:00') {
  if (text.length < ANSWER_MIN_CHARS) return 'short';
  if (text.length > ANSWER_MAX_CHARS) return 'long';
  if (/[*#_`<>[\]{}|]/.test(text) || /\n/.test(text)) return 'format';
  const parts = sentences(text);
  if (parts.length !== 2) return 'sentences';
  if (/\d/.test(parts[0])) return 'numbers';
  if (!RING_WORDS.test(parts[0].toLowerCase())) return 'ring';
  const lower = text.toLowerCase();
  if (FORBIDDEN.some((re) => re.test(lower))) return 'forbidden';
  if (BREATHING.some((re) => re.test(lower))) return 'breathing';
  if (ESOTERIC.some((re) => re.test(lower))) return 'esoteric';
  if (JARGON.some((re) => re.test(lower))) return 'jargon';
  if (HOROSCOPE.some((re) => re.test(lower))) return 'horoscope';
  if (TOUCHY.some((re) => re.test(lower))) return 'touchy';
  const now = minuteOf(time);
  if (now >= DAY_FROM && now < EVENING_FROM && NIGHT_TALK.some((re) => re.test(lower))) return 'time';
  if (previousActions.some((a) => similar(parts[1], a))) return 'repeat';
  return null;
}

/** Причина отказа — словами для повтора. */
const PROBLEM_TEXT = {
  short: 'слишком коротко',
  long: 'длиннее 130 символов — сократи',
  ring: 'первое предложение должно опираться на датчики кольца: что пульс, движение или фон напряжения делают за последние часы',
  horoscope: 'не ярлык настроения, а тренд по датчикам кольца',
  touchy: 'без прикосновений к себе — нужно простое действие взрослого человека',
  format: 'есть разметка или переводы строк',
  sentences: 'нужно ровно два коротких предложения',
  numbers: 'в наблюдении есть цифры',
  forbidden: 'есть запрещённые слова (медицина, глюкоза, сахар, давление или бренды)',
  breathing: 'дыхательные упражнения запрещены — предложи другое простое действие',
  esoteric: 'слишком сложно или эзотерично — нужно простое действие на 30 секунд за столом или на ходу',
  jargon: 'заумные слова — скажи проще, по-человечески',
  time: 'сейчас день — про ночной сон не говори, совет про здесь и сейчас',
  repeat: 'действие повторяет одно из previously_suggested_actions — предложи другое',
};

// ── Запрос ──────────────────────────────────────────────────────────────────────────────────────

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScore = (v) => v === null || (typeof v === 'number' && v >= 0 && v <= 100);
const isNum = (v, min, max) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isClock = (v) => typeof v === 'string' && /^\d\d:\d\d$/.test(v);
const isClockOrNull = (v) => v === null || isClock(v);
/** Короткая подпись из приложения («Спокойное кардио», «Обед»): без переводов строк и разметки. */
const isLabel = (v, max = 40) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\n\r<>{}]/.test(v);

function validateProfile(p) {
  return (
    isObject(p) &&
    (p.sex === null || has(SEX_TEXT, p.sex)) &&
    isNum(p.age, 5, 120) &&
    isNum(p.heightCm, 50, 260) &&
    isNum(p.weightKg, 20, 350) &&
    (p.goal === null || has(GOAL_TEXT, p.goal))
  );
}

function validateDay(d) {
  return (
    isObject(d) &&
    isInt(d.ago, 0, 14) &&
    isClockOrNull(d.asleep) &&
    isClockOrNull(d.awake) &&
    isNum(d.sleepMin, 0, 1440) &&
    isNum(d.deepMin, 0, 1440) &&
    isNum(d.nightPulse, 20, 220) &&
    isNum(d.hrv, 0, 400) &&
    isNum(d.restingPulse, 20, 220) &&
    isNum(d.spo2, 50, 100) &&
    isNum(d.stress, 0, 100) &&
    isNum(d.steps, 0, 200000) &&
    isNum(d.stepNorm, 0, 50000) &&
    isNum(d.calories, 0, 20000) &&
    isNum(d.load, 0, 5000) &&
    (d.workout === null || has(WORKOUT_TEXT, d.workout)) &&
    Array.isArray(d.meals) &&
    d.meals.length <= 12 &&
    d.meals.every(isClock)
  );
}

function validatePlan(plan) {
  if (!isObject(plan) || typeof plan.noCoffee !== 'boolean') return false;
  const w = plan.workout;
  const workoutOk =
    w === null ||
    (isObject(w) && isLabel(w.title) && isLabel(w.effort) && typeof w.minutes === 'number' && isNum(w.minutes, 0, 300) &&
      isClock(w.from) && isClock(w.to));
  const c = plan.coffee;
  const coffeeOk = c === null || (isObject(c) && isClock(c.from) && isClock(c.until) && isNum(c.cups, 0, 10));
  const mealsOk =
    Array.isArray(plan.meals) && plan.meals.length <= 6 && plan.meals.every((m) => isObject(m) && isLabel(m.title, 20) && isClock(m.time));
  const b = plan.bedtime;
  const bedtimeOk =
    b === null ||
    (isObject(b) && isClock(b.from) && isClock(b.to) && isClock(b.wake) &&
      typeof b.needMinutes === 'number' && isNum(b.needMinutes, 0, 1440) &&
      typeof b.debtMinutes === 'number' && isNum(b.debtMinutes, 0, 3000));
  return workoutOk && coffeeOk && mealsOk && bedtimeOk;
}

/** Проверка тела запроса: только ожидаемые поля и разумные значения. Возвращает причину отказа или null. */
function validate(p) {
  if (!isObject(p)) return 'body';
  if (!has(MODE_TEXT, p.mode)) return 'mode';
  if (!isClock(p.time)) return 'time';
  if (!validateProfile(p.profile)) return 'profile';
  const sc = p.scores;
  if (!isObject(sc) || !isScore(sc.total) || !isScore(sc.sleep) || !isScore(sc.activity) || !isScore(sc.organism)) return 'scores';
  if (!Array.isArray(p.days) || p.days.length > 15 || !p.days.every(validateDay)) return 'days';
  const h = p.hours;
  if (h !== null && (!isObject(h) || !isInt(h.from, 0, 23) || !Array.isArray(h.steps) || h.steps.length > 24 || !h.steps.every((v) => isNum(v, 0, 50000) && v !== null))) {
    return 'hours';
  }
  if (h && h.stress !== undefined && (!Array.isArray(h.stress) || h.stress.length !== h.steps.length || !h.stress.every((v) => isNum(v, 0, 100)))) {
    return 'hours';
  }
  if (h && h.pulse !== undefined && (!Array.isArray(h.pulse) || h.pulse.length !== h.steps.length || !h.pulse.every((v) => isNum(v, 20, 220)))) {
    return 'hours';
  }
  if (!validatePlan(p.plan)) return 'plan';
  if (!Array.isArray(p.recent) || p.recent.length > 5 || p.recent.some((t) => typeof t !== 'string' || t.length > 400)) {
    return 'recent';
  }
  // Необязательно (старые сборки не шлют): метки прошлых мнений, по одной на строку `recent`.
  if (p.said !== undefined && !validateSaid(p.said, p.recent.length)) return 'said';
  if (p.history !== undefined && !validateHistory(p.history)) return 'history';
  if (p.past_opinions !== undefined && !validatePast(p.past_opinions)) return 'past_opinions';
  return null;
}

function validatePast(past) {
  return (
    Array.isArray(past) &&
    past.length <= 30 &&
    past.every((o) => isObject(o) && isInt(o.ago, 0, 14) && has(MODE_TEXT, o.slot) && typeof o.text === 'string' && o.text.length <= 400)
  );
}
function validateHistory(history) {
  return (
    Array.isArray(history) &&
    history.length <= 30 &&
    history.every((h) => isObject(h) && isInt(h.ago, 0, 14) && Array.isArray(h.focus) && h.focus.length <= 4 && h.focus.every(isTag))
  );
}
const isTag = (v) => typeof v === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(v) && v.length <= 30;
function validateSaid(said, length) {
  return (
    Array.isArray(said) &&
    said.length === length &&
    said.every((x) => x === null || (isObject(x) && Array.isArray(x.focus) && x.focus.length <= 4 && x.focus.every(isTag) && (x.action === null || isTag(x.action))))
  );
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const header = (event, name) => {
  const headers = (event && event.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

async function handler(event, context) {
  if (event.httpMethod && event.httpMethod !== 'POST') return reply(405, { error: 'method' });
  const appKey = process.env.APP_KEY;
  if (!appKey || header(event, 'x-vuelo-key') !== appKey) return reply(403, { error: 'forbidden' });

  let body = event.body || '';
  if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  if (body.length > MAX_BODY_CHARS) return reply(413, { error: 'too large' });
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, { error: 'json' });
  }
  const invalid = validate(payload);
  if (invalid) return reply(400, { error: invalid });

  const token = context && context.token && context.token.access_token;
  const folder = process.env.FOLDER_ID;
  if (!token || !folder) return reply(500, { error: 'service account or FOLDER_ID is not set' });
  const model = process.env.MODEL || 'yandexgpt';

  const input = modelInput(payload);
  const messages = [
    { role: 'system', text: SYSTEM_PROMPT },
    { role: 'user', text: JSON.stringify(input) },
  ];
  const started = Date.now();
  const timeLeft = () => Math.min(LLM_TIMEOUT_MS, DEADLINE_MS - (Date.now() - started));

  let problem = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0 && DEADLINE_MS - (Date.now() - started) < RETRY_MIN_MS) break;
    const result = await askModel({ token, folder, model, messages, temperature: TEMPERATURE, timeoutMs: timeLeft() });
    if (result.status) return reply(result.status, { error: result.error });
    const text = cleanAnswer(result.text);
    problem = answerProblem(text, input.previously_suggested_actions, payload.time);
    if (!problem) return reply(200, { text, mode: 'free', v: VERSION });
    // Причина — в лог функции, без текста ответа. Повтор — с объяснением, что не так.
    console.warn('answer rejected', problem);
    messages.push({ role: 'assistant', text: result.text }, { role: 'user', text: `Ответ не подходит: ${PROBLEM_TEXT[problem]}. Напиши заново по правилам — ровно два предложения, до 130 символов.` });
  }
  return reply(502, { error: `answer ${problem || 'timeout'}` });
}

/** Один запрос к YandexGPT: `{ text }` или `{ status, error }`. */
async function askModel({ token, folder, model, messages, timeoutMs, temperature }) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-folder-id': folder,
        'x-data-logging-enabled': 'false',
      },
      body: JSON.stringify({
        modelUri: `gpt://${folder}/${model}/latest`,
        completionOptions: { stream: false, temperature, maxTokens: '300' },
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: 504, error: `llm unreachable: ${e && e.name}` };
  }
  if (!response.ok) {
    // Текст ошибки Яндекса — в лог функции (без данных пользователя): по нему видно, что не так с доступом.
    console.error('llm error', response.status, (await response.text()).slice(0, 500));
    return { status: 502, error: `llm ${response.status}` };
  }
  const data = await response.json();
  const alt = data && data.result && data.result.alternatives && data.result.alternatives[0];
  const text = alt && alt.message && typeof alt.message.text === 'string' ? alt.message.text.trim() : '';
  return text ? { text } : { status: 502, error: 'empty' };
}

module.exports = {
  handler, validate, modelInput, pastOf, sentences, answerProblem, cleanAnswer, similar, SYSTEM_PROMPT, VERSION,
};
