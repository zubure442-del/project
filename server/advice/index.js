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
const VERSION = 4;
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
 * Системный запрос. Только алгоритм мышления, ограничения и формат (владелец 26.09): никаких связок
 * «показатель → действие» и примеров с метриками — иначе модель их заучивает и повторяет.
 */
const SYSTEM_PROMPT = `Ты — Лис, наблюдатель в приложении Vuelo к умному кольцу. Ты пишешь человеку одно короткое сообщение, обращаясь на «вы».

На входе — JSON с данными кольца:
- now: slot — отрезок дня (morning — после пробуждения, day — день, evening — перед сном) и местное время;
- person: пол, возраст, рост, вес, цель;
- days: строки по дням, ago — сколько дней назад (0 — сегодня; сон в строке — ночь, после которой начался этот день). Поля: asleep и awake — время засыпания и подъёма, sleep_min и deep_min — сон и глубокий сон в минутах, night_pulse — средний пульс во сне, hrv_ms — вариабельность ритма, resting_pulse — пульс покоя, spo2 — кислород, day_stress — средний стресс 9:00–21:00 по шкале 0–100, steps и step_norm — шаги и личная норма, active_kcal — активные калории, training_load — нагрузка по пульсу, workout — распознанная тренировка, meal_times — моменты, когда начинался подъём после еды. null — данных нет, это не ноль;
- today_by_hour: сегодняшние ряды по часам, начиная с from_hour: steps и stress;
- previous_opinions: что ты уже говорил этому человеку, по порядку, с тем, когда;
- previously_suggested_actions: микро-действия, которые ты уже предлагал.

Как думать (рассуждай про себя, в ответ рассуждения не пиши):
1. По каждому ряду сам определи, что обычно для этого человека: уровень, разброс, привычное время. Сравнивай только с ним самим, не с общими нормами.
2. Найди то, что выбивается: отклонения сегодняшних значений от его обычного, сдвиги во времени суток, тренды, которые тянутся несколько дней, и прежде всего расхождения между рядами — где один ряд изменился, а связанный с ним повёл себя не так, как обычно у этого человека, и где изменение одного ряда по времени опережает изменение другого.
3. Выбери одну находку — самую неочевидную и значимую сейчас. То, что человек и так видит в приложении готовой цифрой, само по себе находкой не считается.
4. Построй гипотезу: какой физиологический механизм мог дать такую картину. Это твоя догадка, а не диагноз.
5. Сверься с previous_opinions. Если нежелательное состояние держится и о нём уже говорилось — не замалчивай его и не меняй тему произвольно, а зайди через другой физиологический рычаг: другую систему организма и другой канал воздействия. Если состояние изменилось, это и есть новость.
6. Подбери одно микро-действие под этот механизм: конкретное, выполнимое прямо сейчас за одну-три минуты там, где человек находится, без инвентаря. Оно опирается на спортивную физиологию, нейробиологию или эргономику: проприоцепцию, сенсорные триггеры, чередование фаз напряжения и расслабления, положение и опору тела, температурный режим. Скажи точно, что сделать телом и в каком порядке.
7. Сверь действие с previously_suggested_actions: оно не должно повторять ни одно из них ни по смыслу, ни по механизму. Совпадает — выбери другой рычаг.

Запрещено:
- капитанские бытовые советы: погулять, пройтись, отдохнуть, выпить воды, подышать, поспать подольше, лечь пораньше, расслабиться, сделать перерыв, больше двигаться, заняться спортом, не нервничать;
- логика «раз показатель такой — сделайте стандартное действие»;
- диагнозы, болезни, лекарства, врачи, обещания результата, оценки внешности и веса;
- слова «глюкоза», «сахар», «давление», названия других приложений и брендов;
- приветствия, вопросы, списки, эмодзи, кавычки, разметка.

Ответ — ровно два предложения на русском, вместе не длиннее 200 символов:
1. Ёмкая констатация обнаруженного физиологического паттерна и его вероятной причины, как твоя догадка, без цифр и без названий показателей.
2. Одно нестандартное микро-действие, которое можно сделать прямо сейчас, в повелительном наклонении.
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

/** JSON для модели: ряды как есть, без выводов и готовых связок. */
function modelInput(p) {
  const pr = p.profile;
  const past = pastOf(p);
  const days = [...p.days]
    .sort((a, b) => b.ago - a.ago)
    .map((d) => ({
      ago: d.ago,
      asleep: d.asleep,
      awake: d.awake,
      sleep_min: d.sleepMin,
      deep_min: d.deepMin,
      night_pulse: d.nightPulse,
      hrv_ms: d.hrv,
      resting_pulse: d.restingPulse,
      spo2: d.spo2,
      day_stress: d.stress,
      steps: d.steps,
      step_norm: d.stepNorm,
      active_kcal: d.calories,
      training_load: d.load,
      workout: d.workout ? WORKOUT_TEXT[d.workout] : null,
      meal_times: d.meals,
    }));
  const h = p.hours;
  return {
    now: { slot: p.mode, time: p.time },
    person: {
      sex: pr.sex ? SEX_TEXT[pr.sex] : null,
      age: pr.age,
      height_cm: pr.heightCm,
      weight_kg: pr.weightKg,
      goal: pr.goal ? GOAL_TEXT[pr.goal] : null,
    },
    days,
    today_by_hour: h ? { from_hour: h.from, steps: h.steps, stress: Array.isArray(h.stress) ? h.stress : null } : null,
    previous_opinions: past.map((o) => ({ when: o.when, text: o.text })),
    previously_suggested_actions: past.filter((o) => o.action).map((o) => o.action),
  };
}

// ── Проверка ответа ─────────────────────────────────────────────────────────────────────────────

const ANSWER_MIN_CHARS = 40;
/** Длиннее приложение не покажет (`AI_ADVICE_MAX_CHARS`). */
const ANSWER_MAX_CHARS = 220;

/** Капитанские советы (владелец 26.09): «погуляйте», «отдохните», «попейте воды», «подышите»… */
const BANAL = [
  /погуля/, /прогул/, /пройди/, /пройтись/, /отдохн/, /отдых/, /попей/, /выпей\S* (стакан|воды|вод)/, /стакан\S* воды/,
  /подыш/, /выспи/, /поспи/, /(лягте|ложитесь|лечь) (пораньше|раньше)/, /расслаб(ьтесь|иться)/, /сделайте перерыв/,
  /больше двига/, /займитесь спорт/, /не нервнича/, /берегите себя/,
];
/** Правила продукта: без диагнозов, медицины, выводов по глюкозе и давлению, обещаний и чужих брендов. */
const FORBIDDEN = [
  /диагноз/, /болезн/, /заболева/, /диабет/, /гипергликем/, /гипогликем/, /гипертон/, /гипотон/, /лечени/, /лекарств/, /таблетк/, /врач/, /доктор/,
  /глюкоз/, /сахар/, /давлени/, /гарантир/, /ожирен/,
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

/** Что не так с ответом: null — годится. */
function answerProblem(text, previousActions = []) {
  if (text.length < ANSWER_MIN_CHARS) return 'short';
  if (text.length > ANSWER_MAX_CHARS) return 'long';
  if (/[*#_`<>[\]{}|]/.test(text) || /\n/.test(text)) return 'format';
  const parts = sentences(text);
  if (parts.length !== 2) return 'sentences';
  if (/\d/.test(parts[0])) return 'numbers';
  const lower = text.toLowerCase();
  if (FORBIDDEN.some((re) => re.test(lower))) return 'forbidden';
  if (BANAL.some((re) => re.test(lower))) return 'banal';
  if (previousActions.some((a) => similar(parts[1], a))) return 'repeat';
  return null;
}

/** Причина отказа — словами для повтора. */
const PROBLEM_TEXT = {
  short: 'слишком коротко',
  long: 'длиннее 200 символов',
  format: 'есть разметка или переводы строк',
  sentences: 'нужно ровно два предложения',
  numbers: 'в первом предложении есть цифры',
  forbidden: 'есть запрещённые слова (медицина, глюкоза, сахар, давление или бренды)',
  banal: 'совет банальный — нужен прикладной микро-приём из физиологии, нейробиологии или эргономики',
  repeat: 'действие повторяет одно из previously_suggested_actions — нужен другой физиологический рычаг',
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
    problem = answerProblem(text, input.previously_suggested_actions);
    if (!problem) return reply(200, { text, mode: 'free', v: VERSION });
    // Причина — в лог функции, без текста ответа. Повтор — с объяснением, что не так.
    console.warn('answer rejected', problem);
    messages.push({ role: 'assistant', text: result.text }, { role: 'user', text: `Ответ не подходит: ${PROBLEM_TEXT[problem]}. Напиши заново по правилам — ровно два предложения.` });
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
  handler, validate, modelInput, pastOf, sentences, answerProblem, cleanAnswer, similar, SYSTEM_PROMPT, VERSION, BANAL,
};
