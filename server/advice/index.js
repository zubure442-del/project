'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT.
 *
 * Приложение присылает всё, кроме имени (решение владельца 26.09): профиль (пол, возраст, рост,
 * вес, цель), оценки дня, таблицу чисел по последним дням (сон, пульс во сне, вариабельность,
 * стресс, шаги, нагрузка, время еды по подъёмам глюкозы — без значений глюкозы и давления),
 * шаги сегодня по часам и план Vuelo на сегодня. Никаких готовых выводов: по числам модель пишет
 * «Мнение Лиса» — не анализ, а личное мнение о том, что с человеком происходит, и одно напутствие.
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

const MODE_TEXT = { morning: 'утро', day: 'день', evening: 'вечер' };
const GOAL_TEXT = { lose: 'снизить вес', keep: 'поддерживать форму', gain: 'набрать мышечную массу' };
const SEX_TEXT = { male: 'мужчина', female: 'женщина' };
const WORKOUT_TEXT = { cardio: 'кардио', strength: 'силовая' };

const SYSTEM_PROMPT = `Ты — Лис, маскот Vuelo — приложения к умному кольцу. Ты давно наблюдаешь за этим человеком и знаешь его ритм. Говоришь с ним сам, от первого лица, как близкий друг, а не как врач или аналитик. Обращайся на «вы».

Тебе дают таблицу чисел по дням. Внимательно прочитай её про себя, но в ответ напиши не анализ, а своё личное мнение: что, по-твоему, сейчас происходит с человеком и почему, — и одно тёплое напутствие.

Как думать:
- Сравнивай сегодня с прошлыми днями и смотри на несколько дней подряд: что копится (усталость, напряжение, недосып), что сбилось (режим сна, поздняя еда), что идёт хорошо (отличное восстановление, ровный режим).
- Выбери одну главную мысль — самую важную для человека сейчас. Каждый раз ищи её заново: не повторяй тему и слова недавних мнений.
- Как читать числа: поздний отход ко сну, короткий или неглубокий сон — недосып; пульс во сне выше обычного и вариабельность ниже обычного — тело плохо восстановилось (частые причины: алкоголь, поздний ужин, кофе вечером, переживания, поздняя тренировка); стресс днём выше обычного несколько дней подряд — человек переживает или перегружен; подъёмы глюкозы — это еда: поздние — поздний ужин, частые — перекусы; разное время сна день ото дня — сбитый режим.

Примеры тона (не копируй):
Похоже, вчерашний вечер вышел долгим — может, бокал вина или поздний ужин: телу ночью не удалось толком расслабиться. Сегодня без подвигов, а вечером — по графику Vuelo.
Вы уже несколько дней как натянутая струна. Выделите сегодня вечер только для себя — без дел и обязательств.
Ночью телу понадобилось больше времени, чтобы расслабиться, — может, виноват поздний кофе. Сегодня последнюю чашку лучше выпить до обеда.
Тело отлично восстановилось — это ваш день. Норма на сегодня 11 000 шагов, и вы её возьмёте.

Правила:
- Не называй показатели и числа из таблицы: никаких «пульс», «вариабельность», «стресс», «глубокий сон», процентов и сравнений «выше/ниже обычного». Говори о человеке: его теле, вечере, режиме, привычках. Число можно, только если это время или цель из плана Vuelo.
- Не советуй прогулки и шаги, если движение — не главная проблема дня.
- Не придумывай того, чего не видно в числах; догадку говори мягко: «похоже», «кажется», «может».
- Учитывай пол, возраст, рост, вес и цель, но не называй их и не оценивай фигуру.
- Нельзя: приветствия, прощания, вопросы; болезни, диагнозы, лекарства, врачи, обещания результата; слова «глюкоза», «сахар в крови», «давление»; оценки «из 100»; другие приложения и бренды, кроме Vuelo; эмодзи, списки, кавычки.

Не больше 190 символов.`;

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
  return lines.length ? ['План Vuelo на сегодня (человек его видит; можно сослаться на «график Vuelo»):', ...lines] : [];
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
        completionOptions: { stream: false, temperature: 0.75, maxTokens: '300' },
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
