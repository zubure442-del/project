'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT («Мнение Лиса»).
 *
 * Владелец 26.09, новая архитектура: модель не умеет считать ряды данных — из сырого JSON выходили
 * тавтологии, выдуманные «дела» и одни и те же фразы. Теперь физиологию считает приложение (движок
 * `src/domain/physiology.ts`: личные нормы, четыре временных слоя, одна доминантная связка), а сюда
 * приходит готовый вывод — две фразы без цифр:
 * - `insight.consequence` — что с телом сейчас;
 * - `insight.root_cause` — первопричина из истории кольца.
 * Модель получает ТОЛЬКО эти две фразы и пересказывает их голосом Лиса: два коротких предложения
 * до 130 символов, первое — следствие, второе — причина. Функция проверяет ответ (`answerProblem`):
 * без цифр, команд, выдуманных обстоятельств, шаблонных «Возможно/Вероятно», зауми и повтора прежних
 * мнений (`past_opinions` — только для этой проверки, модели не уходят). Не прошёл — один повтор
 * с причиной; и он мимо — 502, в приложении шаблонный совет.
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
const VERSION = 13;
const MAX_BODY_CHARS = 16000;
/** Длина фразы движка: короткие предложения без цифр. */
const INSIGHT_MAX_CHARS = 200;
const LLM_TIMEOUT_MS = 12000;
/** Сколько функция готова ждать модель в сумме: приложение ждёт ответ 15 с. */
const DEADLINE_MS = 13000;
/** Меньше этого на повтор не остаётся — не пробуем. */
const RETRY_MIN_MS = 4000;
/** Пересказ, а не сочинение; 0.7 — чтобы одинаковые связки звучали разными словами, смысл держит проверка. */
const TEMPERATURE = 0.7;

const MODE_TEXT = { morning: 'утро, после пробуждения', day: 'день', evening: 'вечер, перед сном' };

/**
 * Системный запрос (владелец 26.09, седьмая версия): модель ничего не анализирует — факт и причину
 * уже нашёл движок приложения по всем показателям кольца (пульс, стресс, сон, кислород, давление,
 * сахар, еда, нагрузка). Её дело — сказать это чистым разговорным русским, ничего не добавив от себя.
 */
const SYSTEM_PROMPT = `Ты — Лис, тёплый и внимательный компаньон в приложении Vuelo к умному кольцу. Приложение уже разобрало все данные кольца — пульс, стресс, сон, кислород, давление, сахар, еду и нагрузку — и нашло главное. Твоя задача — сказать это человеку на «вы» чистым современным разговорным русским, как говорит умный друг.

На входе JSON:
- consequence — что сейчас происходит с телом;
- root_cause — первопричина из истории кольца.

Ответ — ровно два предложения, вместе примерно 90–125 символов, не короче 80:
1. Первое — consequence своими словами.
2. Второе — root_cause своими словами, как дружеская догадка, как это связано («похоже, это после…», «кажется, сказывается…»).

Как звучать:
- простыми словами, как в жизни: «пульс держится выше обычного», «вчера на тренировке была большая нагрузка», «частые перекусы», «давление выше вашего обычного», «ночью кислород проседал»;
- давление, сахар, кислород, пульс и стресс называй прямо, но без цифр и без диагнозов;
- без канцелярита: никаких «в покое», «в спокойствии», «наблюдается», «отмечается», «Причина —»;
- без вычурного фольклора и сленга: никаких «мотор», «шпарит», «барахлит», «тарахтит»;
- не начинай предложения с «Возможно», «Вероятно», «Скорее всего», «Наверное».

Нельзя:
- ничего добавлять и убирать: не придумывай новых причин и обстоятельств жизни — дел, работы, задач, графика, режима дня, загруженности;
- менять смысл и силу: «чуть выше обычного» не превращай в «скачет», «в вашей норме» — в «отлично»; что названо (пульс, стресс, давление, сахар, кислород, сон, еда, нагрузка), то и назови;
- советы, команды и призывы: «сделайте», «иди», «попробуйте», «встаньте», «отдохните», «разомните» и любые другие;
- цифры, диагнозы и болезни, врачей и лечение, обещания, ярлыки вроде «вы устали»;
- приветствия, вопросы, списки, эмодзи и кавычки.
Больше ничего не пиши.`;

/** Предложения текста: по точке, восклицательному или вопросительному знаку и многоточию. */
const sentences = (text) =>
  String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z«"])/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Тексты прошлых мнений Лиса — только для проверки повторов, модели не уходят. */
const pastOf = (p) => (Array.isArray(p.past_opinions) ? p.past_opinions.map((o) => o.text) : []);

/** JSON для модели: только вывод движка — следствие и первопричина. */
function modelInput(p) {
  return { consequence: p.insight.consequence, root_cause: p.insight.root_cause };
}

// ── Проверка ответа ─────────────────────────────────────────────────────────────────────────────

/**
 * Короче — это уже не пересказ связки («Пульс скачет. Вы поздно легли спать.», владелец 26.09).
 * 70 оказалось строго: модель писала 55–65 символов, и почти каждый ответ уходил в запасную фразу.
 */
const ANSWER_MIN_CHARS = 50;
/** На последней попытке «коротко» и «похоже на прежнее» — не повод отдавать шаблонную фразу движка. */
const SOFT_MIN_CHARS = 40;
const SOFT_PROBLEMS = new Set(['short', 'repeat']);
/** Плашка на главном экране маленькая: длиннее текст обрезается на полуслове (владелец 26.09). */
const ANSWER_MAX_CHARS = 130;
/** Связка движка как запасной ответ — до предела карточки в приложении (`AI_ADVICE_MAX_CHARS`). */
const ENGINE_MAX_CHARS = 140;
/** Модель просим короче (125): так ответ почти никогда не упирается в предел проверки. */

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
const COMMANDS = /(^|[^а-яё])(сделайте|попробуйте|встаньте|отдохните|разомните|разомнитесь|пройдитесь|прогуляйтесь|погуляйте|выпейте|попейте|посмотрите|опустите|поднимите|выпрямите|потянитесь|проветрите|сбавьте|переключитесь|отвлекитесь|займитесь|найдите|уделите|позвольте|дайте|возьмите|сходите|лягте|ложитесь|постарайтесь|старайтесь|не забудьте|обратите|двигайтесь|расслабьтесь|сосредоточьтесь|снизьте|поставьте|откройте|закройте|выйдите|подвигайтесь|разгрузите|смените|следите|давайте|иди|идите|сделай|попробуй|встань|отдохни|разомни|выпей|ложись|пройдись)([^а-яё]|$)/;
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
  /кислород|давлени|сахар|еда|еды|перекус|ужин|мышц|нагрузк|стресс|пульс|сердц|напряж|фон|вариабельн|ноч|(^|[^а-яё])(сон|сна|сном|сне)([^а-яё]|$)|вчера|накануне|восстанов|ресурс|запас|разрядк|холост|береж|стимулятор|кофе|отдых|сил[аыуе]?([^а-яё]|$)/;
const DAY_FROM = 12 * 60;
const EVENING_FROM = 20 * 60;
/**
 * Правила продукта: без диагнозов, болезней, лечения, обещаний и чужих брендов. Давление, сахар
 * и кислород как процессы тела называть можно (владелец 26.09) — без цифр и диагнозов.
 */
const FORBIDDEN = [
  /диагноз/, /болезн/, /заболева/, /диабет/, /гипергликем/, /гипогликем/, /гипертон/, /гипотон/, /лечени/, /лекарств/,
  /таблетк/, /врач/, /доктор/, /гарантир/, /ожирен/, /инсульт/, /инфаркт/, /гипокси/, /апноэ/, /аритми/, /тахикард/,
  /whoop/, /oura/, /garmin/, /apple/, /yandex/, /яндекс/, /алиса/, /gpt/,
];
/** Канцелярит (владелец 26.09): «в покое», «наблюдается», «Причина —». */
const CLERICAL = /(^|[^а-яё])(в покое|в спокойствии|наблюдает\S*|отмечает\S*|данн\S* показател\S*)([^а-яё]|$)|(^|[^а-яё])причин[аы]?\s*[—:–-]/;
/** Вычурный фольклор и сленг вместо простых слов: «мотор», «шпарит». */
const SLANG = /(^|[^а-яё])(мотор\S*|шпар\S*|барахл\S*|тарахт\S*|пашет|движок\S*|организмус)([^а-яё]|$)/;
/** Шаблонные вводные в начале предложения (владелец 26.09): догадка звучит живее без них. */
const HEDGE = /^(возможно|вероятно|скорее всего|наверное|может быть|должно быть)([^а-яё]|$)/;
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
/**
 * О чём говорит фраза: пересказ должен назвать то же самое (владелец 26.09: вместо «пульс чуть выше
 * обычного» модель написала «Пульс скачет», а причину урезала до трёх слов).
 */
const SUBJECTS = [
  /пульс/, /стресс/, /давлени/, /сахар/, /кислород/,
  /(^|[^а-яё])ед[аыуе]([^а-яё]|$)|поел|переварив|перекус|ужин/,
  /нагрузк|трениров|мышц/, /восстан/, /движ|двига/,
  /ноч|(^|[^а-яё])(сон|сна|сном|сне)([^а-яё]|$)|спал|легли|уснул/,
];
/** Слова, которые усиливают смысл, — можно, только если они есть в самой связке. */
const DRAMA = /скач|прыга|зашкал|рухн|обвал|бешен|на пределе|истощ|катастроф|отличн|идеальн|прекрасн/;

/** Пересказ потерял то, о чём фраза, или сгустил краски. null — смысл на месте. */
function meaningProblem(text, insight) {
  const lower = text.toLowerCase();
  const source = `${insight.consequence} ${insight.root_cause}`.toLowerCase();
  if (DRAMA.test(lower) && !DRAMA.test(source)) return 'distorted';
  // И в наблюдении, и в причине остаётся самое конкретное (пульс важнее «не двигаетесь», кислород —
  // важнее «ночью»): список SUBJECTS — от конкретного к общему. Требовать всё названное было строго:
  // «хотя вы сидите» вместо «хотя вы не двигаетесь» — тот же смысл.
  for (const phrase of [insight.consequence, insight.root_cause]) {
    const main = SUBJECTS.find((re) => re.test(phrase.toLowerCase()));
    if (main && !main.test(lower)) return 'lost';
  }
  return null;
}

function answerProblem(text, previous = [], time = '15:00', insight = null, soft = false) {
  if (text.length < (soft ? SOFT_MIN_CHARS : ANSWER_MIN_CHARS)) return 'short';
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
  if (HEDGE.test(first) || HEDGE.test(second)) return 'hedge';
  if (CLERICAL.test(lower)) return 'clerical';
  if (SLANG.test(lower)) return 'slang';
  if (ACTIVITY.test(first) && ACTIVITY.test(second) && !OTHER_CAUSE.test(second)) return 'tautology';
  if (insight) {
    const meaning = meaningProblem(text, insight);
    if (meaning) return meaning;
  }
  if (!soft && previous.some((a) => similar(text, a))) return 'repeat';
  return null;
}

/** Причина отказа — словами для повтора. */
const PROBLEM_TEXT = {
  short: 'слишком коротко — перескажи и следствие, и причину полностью',
  long: 'длиннее 130 символов — сократи',
  horoscope: 'не ярлык настроения, а наблюдение за телом и его причина',
  touchy: 'без прикосновений к себе и советов',
  command: 'никаких советов и команд — только наблюдение за телом и дружеская догадка о причине',
  clerical: 'без канцелярита («в покое», «наблюдается», «Причина —») — скажи простыми словами',
  slang: 'без сленга и фольклора («мотор», «шпарит») — чистый разговорный язык',
  distorted: 'не сгущай и не меняй смысл: пересказывай consequence и root_cause с той же силой',
  lost: 'потерялось, о чём речь: назови то же, что в consequence и root_cause',
  hedge: 'без шаблонных вводных «Возможно», «Вероятно», «Скорее всего» в начале предложения',
  format: 'есть разметка или переводы строк',
  sentences: 'нужно ровно два коротких предложения',
  numbers: 'в ответе есть цифры',
  forbidden: 'есть запрещённые слова (диагнозы, болезни, врачи, лечение или бренды)',
  breathing: 'без дыхательных упражнений и советов',
  esoteric: 'без эзотерики и практик — только наблюдение и причина',
  jargon: 'заумные слова — скажи проще, по-человечески',
  day_sleep: 'сейчас день — не зови лечь или поспать',
  invented: 'не придумывай дела, работу, задачи и график человека — только consequence и root_cause',
  tautology: 'второе предложение повторяет первое — перескажи root_cause',
  repeat: 'слишком похоже на то, что Лис уже говорил, — скажи другими словами',
};

// ── Запрос ──────────────────────────────────────────────────────────────────────────────────────

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isClock = (v) => typeof v === 'string' && /^\d\d:\d\d$/.test(v);
const isTag = (v) => typeof v === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(v) && v.length <= 40;
/** Фраза движка: одна строка, без цифр и разметки. */
const isPhrase = (v) => typeof v === 'string' && v.length >= 10 && v.length <= INSIGHT_MAX_CHARS && !/[\n\r<>{}\d]/.test(v);

/** Проверка тела запроса: только ожидаемые поля и разумные значения. Возвращает причину отказа или null. */
function validate(p) {
  if (!isObject(p)) return 'body';
  if (!has(MODE_TEXT, p.mode)) return 'mode';
  if (!isClock(p.time)) return 'time';
  const i = p.insight;
  if (!isObject(i) || !isTag(i.key) || !isPhrase(i.consequence) || !isPhrase(i.root_cause)) return 'insight';
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
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0 && DEADLINE_MS - (Date.now() - started) < RETRY_MIN_MS) break;
    const result = await askModel({ token, folder, model, messages, temperature: TEMPERATURE, timeoutMs: timeLeft() });
    if (result.status) return reply(result.status, { error: result.error });
    const text = cleanAnswer(result.text);
    last = text;
    problem = answerProblem(text, pastOf(payload), payload.time, payload.insight);
    if (!problem) return reply(200, { text, mode: 'free', v: VERSION });
    // Причина — в лог функции, без текста ответа. Повтор — с объяснением, что не так.
    console.warn('answer rejected', problem);
    messages.push({ role: 'assistant', text: result.text }, { role: 'user', text: `Ответ не подходит: ${PROBLEM_TEXT[problem]}. Напиши заново по правилам — ровно два предложения, примерно 90–125 символов: первое — consequence, второе — root_cause.` });
  }
  // Модель дважды не справилась — отдаём саму связку движка: она уже без цифр и простыми словами,
  // и карточка не остаётся без инсайта (владелец 26.09: «посредник ответил 502»). Причина — в `rejected`.
  // Вторая попытка только коротковата или похожа на прежнее мнение (при одной связке за день это
  // неизбежно) — живой пересказ модели всё равно лучше заготовленной фразы движка.
  if (problem && last && SOFT_PROBLEMS.has(problem) && !answerProblem(last, [], payload.time, payload.insight, true)) {
    return reply(200, { text: last, mode: 'free', soft: problem, v: VERSION });
  }
  if (problem) {
    const own = engineAnswer(payload.insight);
    if (own) return reply(200, { text: own, mode: 'engine', rejected: problem, v: VERSION });
  }
  return reply(502, { error: `answer ${problem || 'timeout'}` });
}

/** Связка движка как ответ: следствие и причина подряд, если помещается и проходит основные проверки. */
function engineAnswer(insight) {
  const text = `${insight.consequence} ${insight.root_cause}`.replace(/\s+/g, ' ').trim();
  if (text.length > ENGINE_MAX_CHARS || /\d/.test(text)) return null;
  const lower = text.toLowerCase();
  if (FORBIDDEN.some((re) => re.test(lower)) || COMMANDS.test(lower) || INVENTED_LIFE.test(lower)) return null;
  return text;
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
  handler, validate, modelInput, engineAnswer, pastOf, sentences, answerProblem, cleanAnswer, similar, SYSTEM_PROMPT, VERSION,
};
