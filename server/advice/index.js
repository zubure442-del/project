'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT.
 *
 * Приложение присылает всё, что знает о дне, кроме имени (решение владельца 26.09): профиль
 * (пол, возраст, рост, вес, цель), сон и пульс во сне, шаги и калории, замеры «Организма»
 * (без глюкозы и давления), план дня из своих карточек и наблюдения против своей нормы.
 * Функция пишет из этого запрос к модели по правилам продукта и возвращает { text } —
 * «Мнение Лиса»: Лис от первого лица делает догадку о привычках и даёт одно действие.
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
const MAX_BODY_CHARS = 8000;
const LLM_TIMEOUT_MS = 12000;

const MODE_TEXT = {
  morning: 'утро — говори о прошедшей ночи и о том, как начать день',
  day: 'день — говори о том, что ещё можно успеть сегодня',
  evening: 'вечер — подскажи, как спокойно закончить день и подготовиться ко сну',
};
const GOAL_TEXT = { lose: 'снизить вес', keep: 'поддерживать форму', gain: 'набрать мышечную массу' };
const PART_TEXT = { sleep: 'сон', activity: 'активность', state: 'организм (восстановление по замерам кольца)' };
const SEX_TEXT = { male: 'мужчина', female: 'женщина' };

const SYSTEM_PROMPT = `Ты — Лис, маскот приложения к умному кольцу. Ты сам говоришь с человеком, от первого лица, как внимательный друг, который видит его данные: «Я заметил…», «Похоже, вы…». Обращайся на «вы».

Напиши одно мнение из 2–3 коротких предложений:
1. Начни с догадки о том, что на самом деле происходило в жизни человека. Возьми одно-два самых интересных наблюдения и скажи, что за ними, скорее всего, стоит: частые подъёмы после еды — частые перекусы; поздний подъём вечером и высокий пульс ночью — поздний ужин; мало шагов и долгий отрезок без движения — долго сидели. Говори мягко: «похоже», «судя по всему».
2. Закончи одним конкретным действием на ближайшие часы — со временем или количеством из данных.
3. Не пересказывай то, что человек и так видит в приложении: план тренировки, окна кофе и сна — только подсказка для действия.
4. Все числа и время бери только из данных, новых не придумывай. Можно простой пересчёт: 1 000 шагов — около 10 минут ходьбы.
5. Учитывай пол, возраст, рост, вес и цель, чтобы совет был посильным, но не называй их и не оценивай фигуру.
6. Наблюдений нет и всё хорошо — одной фразой скажи, что сработало, и как это удержать.
7. Не сыпь терминами: вместо «вариабельность ниже» — «организм восстанавливается хуже обычного».

Нельзя:
- банальности без конкретики: «ложитесь пораньше», «пейте больше воды», «больше отдыхайте», «прислушивайтесь к организму», «спланируйте хороший сон»;
- приветствия, прощания, пожелания удачи, вопросы;
- болезни, диагнозы, лекарства, врачи, обещания результата;
- слова «глюкоза», «сахар в крови», «давление» — о еде говори через привычки: перекусы, сладкое, поздний ужин;
- оценки числами «из 100» и объяснения, как они считаются;
- другие приложения, бренды, компании; не называй себя моделью;
- эмодзи, списки, кавычки, разметка.

Не больше 190 символов.

Примеры (не повторяй дословно):
Похоже, вчера был поздний ужин: ночью сердце отдыхало хуже обычного. Сегодня поужинайте до 19:00 — а я посмотрю, как пройдёт ночь.
Я заметил, что с 11 до 14 вы почти не вставали. До нормы 3 800 шагов — это две прогулки по 20 минут, одну можно сделать прямо сейчас.
Сегодня вы перекусываете чаще обычного. До ужина в 18:45 попробуйте обойтись без сладкого — вечером будет легче уснуть.`;

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScore = (v) => v === null || (typeof v === 'number' && v >= 0 && v <= 100);
const isNum = (v, min, max) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
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

function validateSleep(s) {
  if (!isObject(s)) return false;
  const pulseOk =
    s.pulse === null ||
    (isObject(s.pulse) &&
      typeof s.pulse.min === 'number' &&
      typeof s.pulse.avg === 'number' &&
      isNum(s.pulse.min, 20, 220) &&
      isNum(s.pulse.avg, 20, 220) &&
      isNum(s.pulse.vsNormMin, -150, 150) &&
      isNum(s.pulse.vsNormAvg, -150, 150));
  return (
    isScore(s.score) &&
    isNum(s.minutes, 0, 1440) &&
    isNum(s.deepMinutes, 0, 1440) &&
    isNum(s.lightMinutes, 0, 1440) &&
    isClockOrNull(s.asleep) &&
    isClockOrNull(s.awake) &&
    pulseOk
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
  if (!isScore(p.total)) return 'total';
  if (p.weakest !== null && !has(PART_TEXT, p.weakest)) return 'weakest';
  if (!validateSleep(p.sleep)) return 'sleep';
  const a = p.activity;
  if (!isObject(a) || !isScore(a.score) || !isNum(a.steps, 0, 200000) || !isNum(a.norm, 0, 50000) || !isNum(a.caloriesToday, 0, 20000)) {
    return 'activity';
  }
  const o = p.organism;
  if (
    !isObject(o) || !isScore(o.score) || !isNum(o.hrv, 0, 400) || !isNum(o.restingPulse, 20, 220) ||
    !isNum(o.spo2, 50, 100) || !isNum(o.stress, 0, 100)
  ) {
    return 'organism';
  }
  if (!validatePlan(p.plan)) return 'plan';
  if (!Array.isArray(p.insights) || p.insights.length > 8 || p.insights.some((t) => !isLabel(t, 300))) return 'insights';
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
const count = (n) => Math.round(n).toLocaleString('ru-RU');
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const duration = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
};
/** Оценка словами: модели так проще, и чисел «из 100» в ответе не будет. */
const level = (score) =>
  score === null ? 'нет данных' : score >= 80 ? 'хорошо' : score >= 60 ? 'средне' : score >= 40 ? 'ниже обычного' : 'низко';
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
  return lines.length ? ['План приложения на сегодня:', ...lines] : ['Плана на сегодня пока нет.'];
}

/** Показатели дня текстом для модели. */
function buildUserText(p) {
  const s = p.sleep;
  const a = p.activity;
  const o = p.organism;
  const sleepDetails = joined([
    s.deepMinutes !== null && `глубокий ${duration(s.deepMinutes)}`,
    s.lightMinutes !== null && `лёгкий ${duration(s.lightMinutes)}`,
  ]);
  const sleepLine =
    `Сон: ${level(s.score)}` +
    (s.minutes !== null ? ` — ${duration(s.minutes)}${sleepDetails ? ` (${sleepDetails})` : ''}` : '') +
    (s.asleep && s.awake ? `, с ${s.asleep} до ${s.awake}` : '') +
    '.';
  const pulse = s.pulse
    ? `Пульс во сне: минимальный ${s.pulse.min}, средний ${s.pulse.avg}` +
      (s.pulse.vsNormMin !== null && s.pulse.vsNormAvg !== null
        ? `; к своей норме ${signed(s.pulse.vsNormMin)} и ${signed(s.pulse.vsNormAvg)} уд/мин.`
        : '; своей нормы ещё нет.')
    : null;
  const left = a.steps !== null && a.norm !== null ? a.norm - a.steps : null;
  const activityLine =
    `Активность: ${level(a.score)}` +
    (a.steps !== null ? ` — ${count(a.steps)} шагов` : '') +
    (a.norm !== null ? ` при личной норме ${count(a.norm)}` : '') +
    (left !== null ? (left > 0 ? ` (осталось ${count(left)})` : ' (норма выполнена)') : '') +
    (a.caloriesToday !== null ? `, активных калорий сегодня ${count(a.caloriesToday)}` : '') +
    '.';
  const organismDetails = joined([
    o.hrv !== null && `вариабельность ${o.hrv} мс`,
    o.restingPulse !== null && `пульс покоя ${o.restingPulse}`,
    o.spo2 !== null && `кислород ${o.spo2} %`,
    o.stress !== null && `стресс ${o.stress} по шкале 0–100`,
  ]);
  const lines = [
    `Сейчас: ${MODE_TEXT[p.mode]}. Время ${p.time}.`,
    personLine(p.profile),
    `День в целом: ${level(p.total)}.`,
    sleepLine,
    pulse,
    activityLine,
    `Организм: ${level(o.score)}${organismDetails ? ` — ${organismDetails}` : ''}.`,
    `Самая слабая сторона: ${p.weakest ? PART_TEXT[p.weakest] : 'нет, всё хорошо'}.`,
    ...planLines(p.plan),
    ...(p.insights.length
      ? ['Наблюдения за человеком (сравнение со своей нормой за прошлые дни):', ...p.insights.map((t) => `- ${t}`)]
      : ['Особых наблюдений нет: день идёт как обычно.']),
  ].filter(Boolean);
  if (p.recent.length) lines.push(`Недавние мнения (не повторяй их): ${p.recent.map((t) => `— ${t}`).join(' ')}`);
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
  const problem = validate(payload);
  if (problem) return reply(400, { error: problem });

  const token = context && context.token && context.token.access_token;
  const folder = process.env.FOLDER_ID;
  if (!token || !folder) return reply(500, { error: 'service account or FOLDER_ID is not set' });
  const model = process.env.MODEL || 'yandexgpt';

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
        completionOptions: { stream: false, temperature: 0.7, maxTokens: '300' },
        messages: [
          { role: 'system', text: SYSTEM_PROMPT },
          { role: 'user', text: buildUserText(payload) },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (e) {
    return reply(504, { error: `llm unreachable: ${e && e.name}` });
  }
  if (!response.ok) {
    // Текст ошибки Яндекса — в лог функции (без данных пользователя): по нему видно, что не так с доступом.
    console.error('llm error', response.status, (await response.text()).slice(0, 500));
    return reply(502, { error: `llm ${response.status}` });
  }
  const data = await response.json();
  const alt = data && data.result && data.result.alternatives && data.result.alternatives[0];
  const text = alt && alt.message && typeof alt.message.text === 'string' ? alt.message.text.trim() : '';
  if (!text) return reply(502, { error: 'empty' });
  return reply(200, { text });
}

module.exports = { handler, validate, buildUserText, SYSTEM_PROMPT };
