'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT («Мнение Лиса»).
 *
 * Владелец 26.09, концепция v7–v8: Лис не командует и не советует — он ищет физиологическую первопричину.
 * - модель получает сырой JSON — ряды чисел по дням за неделю и по часам за сегодня, профиль и
 *   что Лис уже говорил (`previous_opinions`);
 * - системный запрос (`SYSTEM_PROMPT`) просит собрать картину целиком (движение и неподвижность,
 *   пульс, фон напряжения, время суток, вчерашний день) и ответить двумя предложениями: картина
 *   состояния живыми словами и дружеское предположение о её причине. Готовых фраз в нём нет;
 * - функция лишь проверяет ответ (`answerProblem`): до 130 символов, ровно два предложения, без цифр,
 *   без команд («сделайте», «встаньте»…), выдуманных дел и работы, тавтологий, днём — без призывов поспать,
 *   без ярлыков настроения, запретных слов и повтора прежних мнений.
 *   Не прошёл — один повтор с причиной; и он мимо — 502, в приложении шаблонный совет.
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
const VERSION = 8;
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
 * Системный запрос (владелец 26.09, пятая версия). Лис не командует и не советует, а по физиологии
 * догадывается о причине текущего тонуса. v7 давал тавтологии («мало активны из-за недостатка
 * движения») и выдумывал обстоятельства («загруженность делами») — у кольца нет календаря. Главная
 * причина — днём был запрещён разговор о ночи, и модели не из чего было строить взаимосвязь: теперь
 * ночь и вчерашний день — законная первопричина в любое время, днём запрещены только призывы поспать.
 */
const SYSTEM_PROMPT = `Ты — Лис, тёплый и внимательный компаньон в приложении Vuelo к умному кольцу. Ты видишь только то, что измеряет кольцо, и по этим данным догадываешься, как связаны процессы в теле. Ты не врач и не тренер: не советуешь, не командуешь и не поучаешь. Обращайся на «вы».

На входе JSON:
- current_time — текущее местное время;
- person — пол, возраст, цель;
- days — ряды по дням (ago: 0 — сегодня): сон, глубокий сон, пульс во сне, пульс покоя, вариабельность, стресс днём, шаги и личная норма, время приёмов пищи; null — данных нет;
- today_by_hour — сегодня по часам, начиная с from_hour: steps — шаги, stress — фон напряжения от 0 до 100, pulse — средний пульс; null — замера не было;
- previous_opinions — что ты уже говорил этому человеку раньше.

Больше ты о человеке ничего не знаешь. Календаря, переписки и планов ты не видишь — не придумывай обстоятельства жизни.

Как думать (про себя, в ответ не пиши):
1. Посмотри, что сейчас с телом: движение по часам, пульс против обычного покоя этого человека, фон напряжения, время суток.
2. Найди физиологическую взаимосвязь, которая объясняет текущий тонус:
- пульс или напряжение растут, а шагов почти нет — холостой ход: внутреннее возбуждение или стимуляторы без мышечной разрядки;
- шагов мало, но пульс низкий и напряжение около нуля — режим сбережения энергии: тело спокойно отдыхает в покое;
- силы к вечеру падают или тонус ниже обычного — смотри на ночную базу: длительность и глубина сна накануне, вариабельность, пульс во сне против своей нормы;
- ночь и вчерашний день — законная первопричина того, что происходит сегодня, в любое время суток.
3. Причина должна быть другой природы, чем наблюдение: активность нельзя объяснять самой активностью, напряжение — самим напряжением.
4. Не повторяй мысли и слова из previous_opinions — смотри под новым углом.

Ответ — ровно два коротких предложения, вместе не длиннее 130 символов:
1. Наблюдение за телом сейчас — живыми словами, без цифр.
2. Твоя дружеская догадка о физиологической взаимосвязи — почему тело так себя ведёт.

Нельзя:
- выдумывать обстоятельства жизни: дела, работа, задачи, график, режим дня, загруженность, встречи;
- объяснять наблюдение им самим, как в «мало двигались из-за нехватки движения»;
- советы, команды и нравоучения: никаких «сделайте», «попробуйте», «встаньте», «отдохните», «разомните»; днём — никаких призывов лечь или поспать;
- ярлыки вроде «вы устали» или «вы напряжены» вместо наблюдения и причины;
- сухие конструкции вида «одно выросло, а другое упало» и перечисление показателей;
- дыхательные упражнения, диагнозы, болезни, врачи, заумные и медицинские термины, обещания результата; слова «глюкоза», «сахар», «давление»; другие приложения и бренды;
- цифры, приветствия, вопросы, списки, эмодзи, кавычки.
Больше ничего не пиши.`;

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
    previous_opinions: pastOf(p).map((o) => o.text),
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
/**
 * Команды и призывы (владелец 26.09: «взрослый человек сам знает, что делать, если понимает причину»).
 * Список повелительных глаголов, которые модель чаще всего использует для советов.
 */
const COMMANDS = /(^|[^а-яё])(сделайте|попробуйте|встаньте|отдохните|разомните|разомнитесь|пройдитесь|прогуляйтесь|погуляйте|выпейте|попейте|посмотрите|опустите|поднимите|выпрямите|потянитесь|проветрите|сбавьте|переключитесь|отвлекитесь|займитесь|найдите|уделите|позвольте|дайте|возьмите|сходите|лягте|ложитесь|постарайтесь|старайтесь|не забудьте|обратите|двигайтесь|расслабьтесь|сосредоточьтесь|снизьте|поставьте|откройте|закройте|выйдите|подвигайтесь|разгрузите|смените|следите|давайте)([^а-яё]|$)/;
/**
 * Днём (12:00–20:00) нельзя звать спать (владелец 26.09). Ночь и вчерашний день как причину — можно:
 * прежний запрет любого разговора о ночи днём отрезал модели почти все данные для взаимосвязи.
 * \b в JavaScript не работает с кириллицей — границы слова вручную.
 */
const DAY_SLEEP_ADVICE = /ложитесь|поспите|поспать|вздремн|прилягте|идите спать|лечь спать|дневн\S* сон/;
/**
 * Выдуманные обстоятельства жизни (владелец 26.09): у кольца нет календаря — «дела», «работа»,
 * «загруженность» модель брала из головы. Формы «работа» — только существительное: «сердце работает» можно.
 */
const INVENTED_LIFE =
  /(^|[^а-яё])(дел|дела|делам|делами|делах|работа|работы|работе|работу|работой|рабоч\S*|график\S*|режим\S* дня|распорядк\S*|распорядок|задач\S*|загружен\S*|совещани\S*|созвон\S*|дедлайн\S*|встреч\S*|офис\S*|хлопот\S*|сует\S*)([^а-яё]|$)/;
/**
 * Тавтология (владелец 26.09: «мало активны, возможно, из-за недостатка движения»): оба предложения
 * про движение, а во втором нет другой физиологической опоры — пульса, напряжения, ночи, вчерашнего дня.
 */
const ACTIVITY = /актив|движ|двига|подвижн|шаг|ходьб|прогул|сидени|сидел|сидяч/;
const OTHER_CAUSE =
  /пульс|сердц|напряж|фон|вариабельн|ноч|(^|[^а-яё])(сон|сна|сном|сне)([^а-яё]|$)|вчера|накануне|восстанов|ресурс|запас|разрядк|холост|береж|стимулятор|кофе|отдых|сил[аыуе]?([^а-яё]|$)/;
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

/** Что не так с ответом: null — годится. `previous` — прежние мнения, `time` — текущее «ЧЧ:ММ». */
function answerProblem(text, previous = [], time = '15:00') {
  if (text.length < ANSWER_MIN_CHARS) return 'short';
  if (text.length > ANSWER_MAX_CHARS) return 'long';
  if (/[*#_`<>[\]{}|]/.test(text) || /\n/.test(text)) return 'format';
  const parts = sentences(text);
  if (parts.length !== 2) return 'sentences';
  if (/\d/.test(text)) return 'numbers';
  const lower = text.toLowerCase();
  if (FORBIDDEN.some((re) => re.test(lower))) return 'forbidden';
  if (BREATHING.some((re) => re.test(lower))) return 'breathing';
  if (ESOTERIC.some((re) => re.test(lower))) return 'esoteric';
  if (JARGON.some((re) => re.test(lower))) return 'jargon';
  if (HOROSCOPE.some((re) => re.test(lower))) return 'horoscope';
  if (TOUCHY.some((re) => re.test(lower))) return 'touchy';
  if (INVENTED_LIFE.test(lower)) return 'invented';
  const now = minuteOf(time);
  if (now >= DAY_FROM && now < EVENING_FROM && DAY_SLEEP_ADVICE.test(lower)) return 'day_sleep';
  if (COMMANDS.test(lower)) return 'command';
  const [first, second] = parts.map((x) => x.toLowerCase());
  if (ACTIVITY.test(first) && ACTIVITY.test(second) && !OTHER_CAUSE.test(second)) return 'tautology';
  if (previous.some((a) => similar(text, a))) return 'repeat';
  return null;
}

/** Причина отказа — словами для повтора. */
const PROBLEM_TEXT = {
  short: 'слишком коротко',
  long: 'длиннее 130 символов — сократи',
  horoscope: 'не ярлык настроения, а картина состояния и её причина',
  touchy: 'без прикосновений к себе и советов',
  command: 'никаких советов и команд — только наблюдение за телом и дружеская догадка о причине',
  format: 'есть разметка или переводы строк',
  sentences: 'нужно ровно два коротких предложения',
  numbers: 'в ответе есть цифры',
  forbidden: 'есть запрещённые слова (медицина, глюкоза, сахар, давление или бренды)',
  breathing: 'без дыхательных упражнений и советов',
  esoteric: 'без эзотерики и практик — только картина и причина',
  jargon: 'заумные слова — скажи проще, по-человечески',
  day_sleep: 'сейчас день — не зови лечь или поспать; ночь можно называть только как причину',
  invented: 'ты не знаешь о делах, работе, задачах и графике человека — суди только по данным кольца',
  tautology: 'причина повторяет наблюдение — найди взаимосвязь другой природы: пульс, напряжение, ночь, вчерашний день',
  repeat: 'слишком похоже на одно из previous_opinions — посмотри под новым углом',
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
    problem = answerProblem(text, input.previous_opinions, payload.time);
    if (!problem) return reply(200, { text, mode: 'free', v: VERSION });
    // Причина — в лог функции, без текста ответа. Повтор — с объяснением, что не так.
    console.warn('answer rejected', problem);
    messages.push({ role: 'assistant', text: result.text }, { role: 'user', text: `Ответ не подходит: ${PROBLEM_TEXT[problem]}. Напиши заново по правилам — ровно два коротких предложения, до 130 символов: наблюдение за телом и догадка о физиологической причине.` });
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
