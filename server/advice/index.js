'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT.
 *
 * Приложение присылает всё, кроме имени (решение владельца 26.09): профиль (пол, возраст, рост,
 * вес, цель), оценки дня, таблицу чисел по последним дням (сон, пульс во сне, вариабельность,
 * стресс, шаги, нагрузка, время еды по подъёмам глюкозы — без значений глюкозы и давления),
 * шаги сегодня по часам и план Vuelo на сегодня. Никаких готовых выводов: по числам модель пишет
 * «Мнение Лиса» — не анализ, а личное мнение о том, что с человеком происходит, и одно напутствие.
 * Модель отвечает двумя строками — «Думаю:» (рассуждение) и «Лис:» (текст); функция отдаёт
 * `{ text, thought }`, приложение показывает только text, thought виден при проверке через curl.
 * Ключей API здесь нет: функция ходит в YandexGPT от имени своего сервисного аккаунта
 * (роль ai.languageModels.user), токен выдаёт сама платформа (context.token).
 * Яндексу передаётся x-data-logging-enabled: false — запросы не сохраняются у него для обучения.
 * Сама функция ничего не хранит и тело запроса в лог не пишет.
 *
 * Переменные окружения функции:
 *   FOLDER_ID — идентификатор каталога Yandex Cloud;
 *   APP_KEY   — тот же ключ, что EXPO_PUBLIC_ADVICE_KEY в приложении: без него функция отвечает 403;
 *   MODEL     — необязательно: yandexgpt (по умолчанию, YandexGPT Pro), yandexgpt-lite или aliceai-llm.
 * Среда выполнения — Node.js 22 (fetch встроен), точка входа — index.handler.
 */

const { Buffer } = require('node:buffer');

const API_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
const MAX_BODY_CHARS = 12000;
const LLM_TIMEOUT_MS = 12000;
/** Сколько функция готова ждать модель в сумме: приложение ждёт ответ 15 с. */
const DEADLINE_MS = 13000;
/** Меньше этого на вторую попытку не остаётся — не пробуем. */
const RETRY_MIN_MS = 4000;

const MODE_TEXT = { morning: 'утро', day: 'день', evening: 'вечер' };
const GOAL_TEXT = { lose: 'снизить вес', keep: 'поддерживать форму', gain: 'набрать мышечную массу' };
const SEX_TEXT = { male: 'мужчина', female: 'женщина' };
const WORKOUT_TEXT = { cardio: 'кардио', strength: 'силовая' };

/**
 * Правила для модели. Ответ — две строки: «Думаю:» (рассуждение по числам, человеку не показываем)
 * и «Лис:» (сам текст). Рассуждение перед ответом заметно улучшает догадки слабых моделей (Lite):
 * сначала найти в таблице, что отличается, потом назвать причину. Владелец 26.09: причина —
 * конкретная («поздний ужин», а не «что-то задержало»), напутствие — пункт плана Vuelo с его временем
 * («выделите время для себя по графику Vuelo» — бессмыслица: такого пункта в плане нет).
 */
const SYSTEM_PROMPT = `Ты — Лис, маскот Vuelo — приложения к умному кольцу. Ты давно наблюдаешь за этим человеком и знаешь его ритм. Говоришь с ним сам, от первого лица, как близкий друг, а не как врач или аналитик. Обращайся на «вы».

Тебе дают таблицу чисел по дням и план Vuelo на сегодня. Не пересказывай числа — скажи своё мнение: что, по-твоему, происходит с человеком и почему, — и дай одно конкретное напутствие.

Ответ — ровно две строки:
Думаю: для себя, до 200 символов — что в таблице отличается от обычного (дни и числа) и какую причину ты из этого выводишь.
Лис: сам ответ человеку.

Как найти причину:
- Сравни вчера и сегодня с остальными днями и посмотри на несколько дней подряд. Выбери одну главную мысль — самую важную сейчас; тему и слова недавних мнений не повторяй.
- Причину называй прямо — одну, ту, на которую указывают числа:
  поздний подъём глюкозы (после 21:00) — поздний ужин;
  больше четырёх подъёмов глюкозы за день — перекусы;
  ночью пульс выше и вариабельность ниже обычного, поздней еды не было — бокал вина или кофе после обеда;
  то же после дня с тренировкой или большой нагрузкой — поздняя тренировка, тело не успело остыть;
  стресс днём выше обычного — голова занята делами, трудно отключиться;
  несколько дней подряд стресс растёт, а сон короче — вы давно без передышки;
  засыпание день ото дня всё позже или в разное время — сбился режим;
  короткий сон несколько ночей подряд — накопилась усталость;
  сон дольше и глубже обычного, ночью пульс ниже — тело отлично восстановилось.
- Нельзя расплывчато: «что-то задержало», «что-то помешало», «какие-то дела», «по какой-то причине». Не видно причины — не гадай, скажи о том, что видно: режим, усталость, хорошее восстановление.

Напутствие — одно конкретное действие на ближайшие часы, лучше пункт плана Vuelo с его временем: поужинать в такое-то время, последний кофе до такого-то, лечь в окно из плана, вечер без поздней еды. Время бери только из плана ниже, не из примеров. «По графику Vuelo» — только рядом с таким пунктом и его временем. Нельзя абстрактно: «выделите время для себя», «следуйте графику Vuelo», «не перегружайте себя», «берегите себя».

Пример ответа целиком:
Думаю: вчера подъём глюкозы в 23:10, заснул в 01:20 вместо обычных 23:30, ночью пульс 61 при обычных 55 — поздний ужин.
Лис: Похоже, вчера был поздний ужин — ночью телу было не до отдыха. Сегодня поужинайте по графику Vuelo, в 19:30, и лягте между 22:45 и 23:15.

Ещё хорошие строки «Лис:»:
Лис: Вы уже несколько дней без передышки, как натянутая струна. Сегодня вечер без дел и поздней еды, а лечь лучше в окно Vuelo — до 23:15.
Лис: Кажется, виноват кофе после обеда: ночью тело долго не могло расслабиться. Сегодня последнюю чашку — до 13:00.
Лис: Тело отлично восстановилось — это ваш день. Норма 11 000 шагов, и вы её возьмёте.
Плохо, так нельзя:
Лис: Похоже, вы легли позже обычного — может, что-то задержало. Не перегружайте себя вечером, выделите время для себя по графику Vuelo.

Правила для строки «Лис:»:
- Два предложения, не больше 190 символов.
- Не называй показатели и числа из таблицы: никаких «пульс», «вариабельность», «стресс», «глубокий сон», процентов и сравнений «выше/ниже обычного». Числа — только время из плана Vuelo или норма шагов.
- Утром — про ночь и день впереди, днём — про остаток дня, вечером — про вечер и сон.
- Не советуй прогулки и шаги, если движение — не главная проблема дня.
- Учитывай пол, возраст, рост, вес и цель, но не называй их и не оценивай фигуру.
- Нельзя: приветствия, прощания, вопросы; болезни, диагнозы, лекарства, врачи, обещания результата; слова «глюкоза», «сахар», «давление»; оценки «из 100»; другие приложения и бренды, кроме Vuelo; эмодзи, списки, кавычки.`;

/** Длиннее приложение не покажет (`AI_ADVICE_MAX_CHARS`), короче — это не мнение (`AI_ADVICE_MIN_CHARS`). */
const ANSWER_MIN_CHARS = 20;
const ANSWER_MAX_CHARS = 220;

/** Расплывчатые фразы, за которые владелец ругал ответы (26.09): с ними просим модель переписать. */
const VAGUE = [
  /что-?то (задерж|помеш|случил|отвлек|произош|пошло)/,
  /каки[ех]-?то (дел|причин|обстоятельств)/,
  /по какой-?то причине/,
  /время для себя/,
  /не перегружайте себя/,
  /берегите себя/,
];

/**
 * Ответ модели: «Думаю: …» (рассуждение) и «Лис: …» (текст человеку). Без «Лис:» годится только
 * ответ без рассуждения — его берём целиком. Не разобрать — null.
 */
function parseAnswer(raw) {
  const text = String(raw).replace(/\*/g, '').trim();
  const fox = /Лис\s*:\s*/.exec(text);
  const think = /Думаю\s*:\s*/.exec(text);
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  if (!fox) return think ? null : { text: flat(text), thought: '' };
  const start = fox.index + fox[0].length;
  const said = flat(think && think.index > fox.index ? text.slice(start, think.index) : text.slice(start));
  const thought = think && think.index < fox.index ? flat(text.slice(think.index + think[0].length, fox.index)) : '';
  return said ? { text: said, thought } : null;
}

/** Что не так с текстом «Лис:»: null — годится. */
function answerProblem(text) {
  if (text.length < ANSWER_MIN_CHARS) return 'short';
  if (text.length > ANSWER_MAX_CHARS) return 'long';
  const lower = text.toLowerCase();
  if (VAGUE.some((re) => re.test(lower))) return 'vague';
  // «По графику Vuelo» без времени — ссылка на план ни о чём.
  if (/график\S* vuelo/.test(lower) && !/\d?\d:\d\d/.test(text)) return 'vague';
  return null;
}

/** Что сказать модели, когда просим переписать. */
const RETRY_TEXT = {
  format: 'Нужно ровно две строки: «Думаю: …» и «Лис: …». Ответь ещё раз.',
  short: 'Строка «Лис:» слишком короткая: нужны причина и одно действие. Ответь ещё раз.',
  long: 'Строка «Лис:» длиннее 190 символов. Сократи до двух коротких предложений и ответь ещё раз.',
  vague:
    'Строка «Лис:» расплывчатая. Назови одну конкретную причину, на которую указывают числа, и одно действие ' +
    'с временем из плана Vuelo. Ответь ещё раз.',
};

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
  if (!validatePlan(p.plan)) return 'plan';
  if (!Array.isArray(p.recent) || p.recent.length > 5 || p.recent.some((t) => typeof t !== 'string' || t.length > 400)) {
    return 'recent';
  }
  return null;
}

const plural = (n, forms) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
};
const count = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const duration = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
};
/** «7:20» — длительность в таблице. */
const hm = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const cell = (v, format = String) => (v === null || v === undefined ? '—' : format(v));
const joined = (parts) => parts.filter(Boolean).join(', ');

/** Человек: пол, возраст, рост, вес и цель — только то, что заполнено в профиле. */
function personLine(pr) {
  const person = joined([
    pr.sex && SEX_TEXT[pr.sex],
    pr.age !== null && `${pr.age} ${plural(pr.age, ['год', 'года', 'лет'])}`,
    pr.heightCm !== null && `рост ${pr.heightCm} см`,
    pr.weightKg !== null && `вес ${pr.weightKg} кг`,
  ]);
  return `Человек: ${person || 'профиль не заполнен'}. Цель: ${pr.goal ? GOAL_TEXT[pr.goal] : 'не указана'}.`;
}

const dayName = (ago, time) => (ago === 0 ? `сегодня (до ${time})` : ago === 1 ? 'вчера' : `${ago} дн. назад`);

/** Таблица по дням: строка на день, от старых к сегодняшнему. */
function tableLines(p) {
  if (!p.days.length) return ['Данных по дням пока нет.'];
  const head =
    'день | засыпание | подъём | сон | глубокий | пульс во сне | вариабельность, мс | пульс покоя | кислород, % | ' +
    'стресс днём (0–100) | шаги / норма | активные ккал | нагрузка по пульсу | тренировка | подъёмы глюкозы';
  const rows = [...p.days]
    .sort((a, b) => b.ago - a.ago)
    .map((d) =>
      [
        dayName(d.ago, p.time),
        cell(d.asleep),
        cell(d.awake),
        cell(d.sleepMin, hm),
        cell(d.deepMin, hm),
        cell(d.nightPulse),
        cell(d.hrv),
        cell(d.restingPulse),
        cell(d.spo2),
        cell(d.stress),
        `${cell(d.steps, count)} / ${cell(d.stepNorm, count)}`,
        cell(d.calories, count),
        cell(d.load),
        cell(d.workout, (w) => WORKOUT_TEXT[w]),
        d.meals.length ? d.meals.join(' ') : '—',
      ].join(' | '),
    );
  const lines = ['Таблица по дням (числа кольца; «—» — нет данных):', head, ...rows];
  if (p.hours) {
    lines.push(`Шаги сегодня по часам: ${p.hours.steps.map((v, i) => `${p.hours.from + i} ч — ${count(v)}`).join(', ')}.`);
  }
  return lines;
}

function planLines(plan) {
  const lines = [];
  const w = plan.workout;
  if (w) lines.push(`- тренировка «${w.title}», ${w.minutes} минут, ${w.effort.toLowerCase()}, лучшее время ${w.from}–${w.to};`);
  if (plan.coffee) {
    const c = plan.coffee;
    const cups = c.cups !== null ? `, не больше ${c.cups} ${plural(c.cups, ['чашки', 'чашек', 'чашек'])}` : '';
    lines.push(`- кофе: с ${c.from} до ${c.until}${cups};`);
  } else if (plan.noCoffee) {
    lines.push('- кофе сегодня лучше не пить;');
  }
  if (plan.meals.length) lines.push(`- еда: ${plan.meals.map((m) => `${m.title.toLowerCase()} ${m.time}`).join(', ')};`);
  const b = plan.bedtime;
  if (b) {
    const debt = b.debtMinutes > 0 ? `, накопился долг сна ${duration(b.debtMinutes)}` : ', долга сна нет';
    lines.push(`- сон: лечь с ${b.from} до ${b.to}, подъём ${b.wake}, нужно сна ${duration(b.needMinutes)}${debt}.`);
  }
  return lines.length
    ? ['План Vuelo на сегодня (человек видит его на экране; напутствие — один из этих пунктов с его временем):', ...lines]
    : [];
}

/** Данные для модели: кто человек, оценки, таблица чисел по дням и план Vuelo. Без выводов. */
function buildUserText(p) {
  const sc = p.scores;
  const lines = [
    `Сейчас: ${MODE_TEXT[p.mode]}, ${p.time}.`,
    personLine(p.profile),
    `Оценки Vuelo за сегодня (0–100, человек их видит): день ${cell(sc.total)}, сон ${cell(sc.sleep)}, ` +
      `активность ${cell(sc.activity)}, организм ${cell(sc.organism)}.`,
    ...tableLines(p),
    ...planLines(p.plan),
  ];
  if (p.recent.length) lines.push(`Недавние мнения (не повторяй ни тему, ни слова): ${p.recent.map((t) => `— ${t}`).join(' ')}`);
  return lines.join('\n');
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

  // Ответ не подошёл (нет «Лис:», длинный, расплывчатый) — один раз просим переписать,
  // если приложение ещё ждёт. Не вышло — 502, приложение оставит шаблонный совет.
  const started = Date.now();
  const messages = [
    { role: 'system', text: SYSTEM_PROMPT },
    { role: 'user', text: buildUserText(payload) },
  ];
  let problem = 'empty';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const left = DEADLINE_MS - (Date.now() - started);
    if (attempt > 0 && left < RETRY_MIN_MS) break;
    const result = await askModel({ token, folder, model, messages, timeoutMs: Math.min(LLM_TIMEOUT_MS, left) });
    if (result.status) return reply(result.status, { error: result.error });
    const answer = parseAnswer(result.text);
    problem = answer ? answerProblem(answer.text) : 'format';
    if (!problem) return reply(200, answer);
    // Причина — в лог функции без текста ответа: видно, как часто модель промахивается.
    console.warn('answer rejected', problem, 'attempt', attempt + 1);
    messages.push({ role: 'assistant', text: result.text }, { role: 'user', text: RETRY_TEXT[problem] });
  }
  return reply(502, { error: `answer ${problem}` });
}

/** Один запрос к YandexGPT: `{ text }` или `{ status, error }`. */
async function askModel({ token, folder, model, messages, timeoutMs }) {
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
        completionOptions: { stream: false, temperature: 0.6, maxTokens: '500' },
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

module.exports = { handler, validate, buildUserText, parseAnswer, answerProblem, SYSTEM_PROMPT };
