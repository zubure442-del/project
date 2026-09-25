'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT.
 *
 * Приложение присылает всё, кроме имени (решение владельца 26.09): профиль (пол, возраст, рост,
 * вес, цель), оценки дня, таблицу чисел по последним дням (сон, пульс во сне, вариабельность,
 * стресс, шаги, нагрузка, время еды по подъёмам глюкозы — без значений глюкозы и давления),
 * шаги сегодня по часам и план Vuelo на сегодня.
 *
 * Как ежедневные сообщения Oura (контекст, догадка о причине, одно маленькое действие): главное
 * наблюдение дня выбирает не модель, а эта функция — по правилам и личным нормам человека
 * (`observe`): что видно, вероятная причина и одно действие из плана Vuelo с его временем.
 * Модель только говорит это голосом Лиса. Раньше модель сама читала всю таблицу — Lite путалась
 * и связывала несвязанное («легли поздно — поешьте по графику»; владелец 26.09: «бред»).
 * Функция отдаёт `{ text, finding }`: приложение показывает text, finding (какое наблюдение
 * выбрано) виден при проверке через curl.
 *
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
 * Правила для модели. Наблюдение уже выбрано (`observe`), модель его только говорит — два
 * предложения голосом Лиса: мнение о причине и действие из плана с его временем.
 */
const SYSTEM_PROMPT = `Ты — Лис, маскот Vuelo — приложения к умному кольцу. Ты давно наблюдаешь за этим человеком и знаешь его ритм. Говоришь с ним сам, от первого лица, как близкий друг, а не как врач или аналитик. Обращайся на «вы».

Каждый раз Vuelo по числам кольца выбирает одно главное наблюдение: что видно, вероятную причину и одно действие из плана. Твоя задача — сказать это человеку своими словами, тепло и просто, как короткое сообщение в хорошем приложении для сна. Наблюдение уже выбрано: не ищи другое и ничего к нему не добавляй.

Ответ — только текст, два предложения, не больше 190 символов:
1. Твоё мнение: что с человеком и почему. Причину говори как свою догадку: «похоже», «кажется», «думаю». Причина не видна — скажи только о том, что видно, и ничего не додумывай.
2. Действие из «Что предложить» — с его временем, если оно там есть. Можно добавить короткую поддержку.

Правила:
- Не называй показатели и числа из «Что видно»: никаких «пульс», «вариабельность», «стресс», «глубокий сон», процентов и «выше/ниже обычного». Говори о человеке: теле, ночи, вечере, режиме, привычках. Числа — только из «Что предложить».
- Учитывай пол, возраст и цель, но не называй их и не оценивай фигуру.
- Слова недавних мнений не повторяй.
- Нельзя: приветствия, прощания, вопросы; болезни, диагнозы, лекарства, врачи, обещания результата; слова «глюкоза», «сахар», «давление»; оценки «из 100»; другие приложения и бренды, кроме Vuelo; эмодзи, списки, кавычки; общие слова вроде «что-то задержало», «выделите время для себя», «не перегружайте себя», «берегите себя».

Примеры (времена в них чужие — бери свои из «Что предложить»):
Причина: поздний ужин. Что предложить: поужинать по графику Vuelo в 19:30.
Ответ: Похоже, вчера был поздний ужин — ночью телу пришлось работать, а не отдыхать. Сегодня поужинайте по графику Vuelo, в 19:30.
Причина: вы давно без передышки. Что предложить: лечь между 22:45 и 23:15.
Ответ: Вы уже несколько дней как натянутая струна — пора выдохнуть. Сегодня вечер без дел, а лечь лучше между 22:45 и 23:15.
Причина: бокал вина или кофе после обеда. Что предложить: последнюю чашку кофе — до 13:00.
Ответ: Кажется, ночью телу мешал кофе после обеда или бокал вина. Сегодня последнюю чашку — до 13:00, и вечер пройдёт спокойнее.
Причина: тело отлично восстановилось. Что предложить: норма на сегодня 11 000 шагов.
Ответ: Тело отлично восстановилось — это ваш день. Норма 11 000 шагов, и вы её возьмёте.
Плохо, так нельзя:
Ответ: Похоже, вы легли позже обычного — может, что-то задержало. Не перегружайте себя вечером, выделите время для себя по графику Vuelo.`;

// ── Наблюдение дня ──────────────────────────────────────────────────────────────────────────────

/** Личная норма — среднее прошлых дней таблицы, если их хотя бы столько. */
const NORM_MIN_DAYS = 3;
/** Ночь тяжелее обычного: пульс во сне выше нормы и вариабельность ниже — или одно из них сильно. */
const STRAIN_PULSE_UP = 3;
const STRAIN_HRV_DROP = 0.08;
const STRAIN_PULSE_UP_ALONE = 5;
const STRAIN_HRV_DROP_ALONE = 0.15;
/** Отличное восстановление: ночь не хуже обычного и хотя бы одно заметно лучше. */
const RECOVERY_PULSE_DOWN = 2;
const RECOVERY_HRV_UP = 0.08;
/** Поздняя еда — подъём глюкозы вечером с 21:00 или ночью до 4:00. */
const LATE_MEAL_FROM = 21 * 60;
const NIGHT_UNTIL = 4 * 60;
/** Уснул позже обычного: заметно (для отдельной ночи) и просто позже (как подробность). */
const LATE_BED_MIN = 60;
const LATER_BED_MIN = 45;
/** Три ночи подряд засыпание всё позже, от первой до последней — хотя бы на столько. */
const DRIFT_MIN = 30;
/** Стресс днём выше своего уровня три дня подряд; напряжённый день — на столько выше. */
const STRESS_STREAK_UP = 8;
const TENSE_DAY_UP = 10;
/**
 * Короткий сон три ночи подряд: меньше 6.5 ч или на 45 мин меньше обычного. Долг сна из плана
 * сам по себе не повод: у того, кто всегда спит 6.5 ч, он есть каждый день.
 */
const SHORT_SLEEP_MIN = 390;
const SHORT_SLEEP_UNDER_NORM = 45;
/** Столько приёмов пищи за день — перекусы. */
const SNACKS_FROM = 5;
/** Нагрузка вчера во столько раз выше обычной — тяжёлый день. */
const HEAVY_LOAD_RATIO = 1.5;
/** Сидячий день: после 13:00 шагов меньше половины того, что к этому часу «положено» по норме. */
const LOW_ACTIVITY_FROM = 13 * 60;
const LOW_ACTIVITY_SHARE = 0.5;

const present = (v) => v !== null && v !== undefined;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const clockMin = (c) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));
/** Время засыпания на шкале «от полудня»: 00:40 позже 23:40. */
const nightMin = (m) => (m < 12 * 60 ? m + 1440 : m);
const clockOf = (m) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const asleepMin = (d) => (d && d.asleep ? nightMin(clockMin(d.asleep)) : null);
/** Последний приём пищи дня после полудня. */
const lastMealOf = (d) => {
  const evening = d.meals.map(clockMin).filter((m) => m >= 12 * 60);
  return evening.length ? Math.max(...evening) : null;
};

/** Среднее по дням, где значение есть; меньше NORM_MIN_DAYS дней — нормы нет. */
function normOf(days, pick) {
  const values = days.map(pick).filter(present);
  return values.length >= NORM_MIN_DAYS ? mean(values) : null;
}

/**
 * Действия из плана Vuelo, которые ещё впереди: текст для модели вместе с временем.
 * Ночью (до 4:00) впереди только сон.
 */
function planActions(p, now, today) {
  const plan = p.plan;
  const lateNight = now < NIGHT_UNTIL;
  const ahead = (clock, slack = 0) => !lateNight && clockMin(clock) + slack > now;
  const act = {};
  const b = plan.bedtime;
  if (b && nightMin(clockMin(b.to)) > (lateNight ? now + 1440 : now)) act.bed = `лечь между ${b.from} и ${b.to}`;
  const dinner = plan.meals.find((m) => m.title.toLowerCase() === 'ужин');
  if (dinner && ahead(dinner.time, 30)) act.dinner = `поужинать по графику Vuelo в ${dinner.time}`;
  const next = plan.meals.find((m) => ahead(m.time));
  if (next) act.nextMeal = `${next.title.toLowerCase()} по графику Vuelo в ${next.time}, без перекусов до него`;
  if (plan.noCoffee) act.coffee = 'сегодня обойтись без кофе';
  else if (plan.coffee) act.coffee = ahead(plan.coffee.until) ? `последнюю чашку кофе — до ${plan.coffee.until}` : 'кофе на сегодня уже хватит';
  const w = plan.workout;
  if (w && ahead(w.to)) act.workout = `${w.title.toLowerCase()} с ${w.from} до ${w.to}`;
  if (today && present(today.steps) && today.stepNorm) {
    const left = Math.round((today.stepNorm - today.steps) / 100) * 100;
    if (left > 0) act.steps = `до нормы шагов осталось около ${count(left)}`;
    act.norm = `норма на сегодня ${count(today.stepNorm)} шагов`;
  }
  return act;
}

/**
 * Главное наблюдение дня — одно, по порядку важности, как «находки» Oura: что видно (числа
 * с личной нормой — модели для понимания, в ответ они не идут), вероятная причина (или null —
 * тогда не гадаем) и одно действие из плана. Сегодняшняя строка таблицы — это и прошедшая ночь.
 */
function observe(p) {
  const byAgo = new Map(p.days.map((d) => [d.ago, d]));
  const today = byAgo.get(0) || null;
  const yesterday = byAgo.get(1) || null;
  const prior = p.days.filter((d) => d.ago >= 1);
  const norm = {
    asleep: normOf(prior, asleepMin),
    sleepMin: normOf(prior, (d) => d.sleepMin),
    nightPulse: normOf(prior, (d) => d.nightPulse),
    hrv: normOf(prior, (d) => d.hrv),
    load: normOf(prior, (d) => d.load),
    lastMeal: normOf(p.days.filter((d) => d.ago >= 2), lastMealOf),
  };
  const now = clockMin(p.time);
  const evening = p.mode === 'evening';
  const act = planActions(p, now, today);
  const action = (...keys) => keys.map((k) => act[k]).find(Boolean) || null;
  const found = (id, facts, cause, todo) => ({ id, facts: facts.filter(Boolean), cause, action: todo });

  // Ночь: восстановление против своей нормы.
  const pulseUp = today && present(today.nightPulse) && present(norm.nightPulse) ? today.nightPulse - norm.nightPulse : null;
  const hrvDrop = today && present(today.hrv) && norm.hrv ? 1 - today.hrv / norm.hrv : null;
  const strain =
    (pulseUp !== null && hrvDrop !== null && pulseUp >= STRAIN_PULSE_UP && hrvDrop >= STRAIN_HRV_DROP) ||
    (pulseUp !== null && pulseUp >= STRAIN_PULSE_UP_ALONE) ||
    (hrvDrop !== null && hrvDrop >= STRAIN_HRV_DROP_ALONE);
  const nightParts = [
    pulseUp !== null && `пульс во сне ${today.nightPulse} (обычно ${Math.round(norm.nightPulse)})`,
    hrvDrop !== null && `вариабельность ${today.hrv} мс (обычно ${Math.round(norm.hrv)})`,
  ].filter(Boolean);
  const strainFact = `этой ночью тело отдыхало хуже обычного: ${nightParts.join(', ')}`;

  const bedLate = asleepMin(today) !== null && norm.asleep !== null ? asleepMin(today) - norm.asleep : null;
  const bedFact = bedLate !== null && `уснули в ${today.asleep} (обычно около ${clockOf(norm.asleep)})`;

  // 1. Поздний ужин и тяжёлая или поздняя ночь.
  const lateMeals = [
    ...(yesterday ? yesterday.meals.filter((t) => clockMin(t) >= LATE_MEAL_FROM) : []),
    ...(today ? today.meals.filter((t) => clockMin(t) < NIGHT_UNTIL && (asleepMin(today) === null || nightMin(clockMin(t)) <= asleepMin(today))) : []),
  ];
  const lateMeal = lateMeals.length ? lateMeals[lateMeals.length - 1] : null;
  if (lateMeal && (strain || (bedLate !== null && bedLate >= LATE_BED_MIN))) {
    const usual = norm.lastMeal !== null ? ` (обычно около ${clockOf(norm.lastMeal)})` : '';
    return found(
      'late-meal',
      [`вчера последний приём пищи в ${lateMeal}${usual}`, strain && strainFact, bedLate >= LATER_BED_MIN && bedFact],
      'поздний ужин — ночью телу пришлось переваривать, а не отдыхать',
      action('dinner', 'bed'),
    );
  }

  // 2. Тяжёлая ночь после тренировки или большой нагрузки.
  const heavy = yesterday && (yesterday.workout || (present(yesterday.load) && norm.load && yesterday.load >= norm.load * HEAVY_LOAD_RATIO));
  if (strain && heavy) {
    const what = yesterday.workout ? `вчера была тренировка (${WORKOUT_TEXT[yesterday.workout]})` : 'вчера нагрузка была заметно выше обычной';
    return found('after-workout', [what, strainFact], 'вчерашняя нагрузка — телу нужно больше времени, чтобы восстановиться', action(evening ? 'bed' : 'workout', 'bed'));
  }

  // 3. Несколько дней подряд напряжение (утром сегодняшнего стресса ещё нет — берём три прошлых дня).
  const streakDays = today && present(today.stress) ? [2, 1, 0] : [3, 2, 1];
  const streak = streakDays.map((a) => byAgo.get(a)).map((d) => (d ? d.stress : null));
  const stressBase = normOf(p.days.filter((d) => d.ago > streakDays[0]), (d) => d.stress);
  if (stressBase !== null && streak.every((v) => present(v) && v >= stressBase + STRESS_STREAK_UP)) {
    return found(
      'stress-streak',
      [`стресс днём выше обычного несколько дней подряд: ${streak.join(', ')} (обычно около ${Math.round(stressBase)})`, strain && strainFact],
      'вы давно без передышки — много дел, голова не отключается',
      action(evening ? 'bed' : 'workout', 'bed'),
    );
  }

  // 4. Тяжёлая ночь без поздней еды и нагрузки.
  if (strain) {
    const dayBase = normOf(p.days.filter((d) => d.ago >= 2), (d) => d.stress);
    const tense = yesterday && present(yesterday.stress) && dayBase !== null && yesterday.stress >= dayBase + TENSE_DAY_UP;
    return tense
      ? found('night-strain', [strainFact, `вчера днём стресс ${yesterday.stress} (обычно около ${Math.round(dayBase)})`],
          'напряжённый день — голова долго не отпускала дела', action('bed'))
      : found('night-strain', [strainFact], 'бокал вина или кофе после обеда', action(evening ? 'bed' : 'coffee', 'bed'));
  }

  // 5. Засыпание три ночи подряд всё позже.
  const nights = [2, 1, 0].map((a) => asleepMin(byAgo.get(a)));
  if (nights.every(present) && nights[0] < nights[1] && nights[1] < nights[2] && nights[2] - nights[0] >= DRIFT_MIN && bedLate >= LATER_BED_MIN) {
    const times = [2, 1, 0].map((a) => byAgo.get(a).asleep).join(', ');
    return found('bedtime-drift', [`засыпание три ночи подряд всё позже: ${times} (обычно около ${clockOf(norm.asleep)})`],
      'сбился режим — вечер каждый раз затягивается', action('bed'));
  }

  // 6. Недосып несколько ночей.
  const sleeps = [2, 1, 0].map((a) => byAgo.get(a)).map((d) => (d ? d.sleepMin : null));
  const short = (v) => present(v) && (v < SHORT_SLEEP_MIN || (norm.sleepMin !== null && v <= norm.sleepMin - SHORT_SLEEP_UNDER_NORM));
  const debt = p.plan.bedtime ? p.plan.bedtime.debtMinutes : 0;
  if (sleeps.every(short)) {
    return found(
      'short-sleep',
      [sleeps.every(present) && `сон три последние ночи: ${sleeps.map(hm).join(', ')}` + (norm.sleepMin !== null ? ` (обычно около ${hm(norm.sleepMin)})` : ''),
        debt > 0 && `долг сна ${duration(debt)}`],
      'накопилась усталость',
      action('bed'),
    );
  }

  // 7. Одна поздняя ночь — причину не придумываем.
  if (bedLate !== null && bedLate >= LATE_BED_MIN) return found('late-bed', [bedFact], null, action('bed'));

  // 8. Перекусы.
  const snackDay = [yesterday, today].find((d) => d && d.meals.length >= SNACKS_FROM);
  if (snackDay) {
    const when = snackDay === today ? 'сегодня' : 'вчера';
    return found('snacks', [`${when} ${snackDay.meals.length} приёмов пищи: ${snackDay.meals.join(', ')}`], 'много перекусов', action('nextMeal', 'dinner'));
  }

  // 9. Сидячий день.
  if (today && present(today.steps) && today.stepNorm && now >= LOW_ACTIVITY_FROM) {
    const expected = today.stepNorm * Math.min(1, (now - 8 * 60) / (13 * 60));
    if (today.steps < expected * LOW_ACTIVITY_SHARE) {
      return found('low-activity', [`к ${p.time} — ${count(today.steps)} шагов из ${count(today.stepNorm)}`], 'день выходит сидячим', action('steps'));
    }
  }

  // 10. Отличное восстановление.
  const sleptEnough = today && present(today.sleepMin) && today.sleepMin >= (norm.sleepMin !== null ? norm.sleepMin : 420) - 15;
  const recovered =
    pulseUp !== null && hrvDrop !== null && pulseUp <= 0 && hrvDrop <= 0 && (pulseUp <= -RECOVERY_PULSE_DOWN || hrvDrop <= -RECOVERY_HRV_UP);
  const noNorms = pulseUp === null && hrvDrop === null && p.scores.sleep >= 85 && p.scores.organism >= 80;
  if (sleptEnough && (recovered || noNorms)) {
    return found('good-recovery', [`сон ${hm(today.sleepMin)}`, nightParts.length && `ночью тело отлично отдохнуло: ${nightParts.join(', ')}`],
      'тело отлично восстановилось', action(evening ? 'bed' : 'workout', 'norm'));
  }

  // 11. Ничего не выделяется.
  return found('steady', ['сон, восстановление и нагрузка — как обычно'], 'ровный режим', action(evening ? 'bed' : 'workout', 'nextMeal', 'bed', 'norm'));
}

// ── Ответ модели ────────────────────────────────────────────────────────────────────────────────

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

/** Текст ответа: без «Ответ:» / «Лис:» в начале и рассуждений, если модель их всё же дописала. */
function parseAnswer(raw) {
  let text = String(raw).replace(/\*/g, '').trim();
  const lead = /(?:Лис|Ответ)\s*:\s*/.exec(text);
  if (lead) text = text.slice(lead.index + lead[0].length);
  else if (/Думаю\s*:/.test(text)) return null;
  text = text.replace(/Думаю\s*:[\s\S]*$/, '').replace(/^[→—–-]+/, '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Числа в тексте: «07:00» и «7:00», «11 000» и «11000» — одно и то же. */
const numbersIn = (s) =>
  (s.match(/\d+(?:[:.\u00a0 ]\d+)*/g) || []).map((t) => t.replace(/[\u00a0 ]/g, '').replace('.', ':').replace(/^0(\d)/, '$1'));

/** Что не так с ответом: null — годится. Числа — только из действия, его время — обязательно. */
function answerProblem(text, action = null) {
  if (text.length < ANSWER_MIN_CHARS) return 'short';
  if (text.length > ANSWER_MAX_CHARS) return 'long';
  const lower = text.toLowerCase();
  if (VAGUE.some((re) => re.test(lower))) return 'vague';
  const allowed = numbersIn(action || '');
  const used = numbersIn(text);
  if (used.some((n) => !allowed.includes(n))) return 'numbers';
  const times = allowed.filter((n) => n.includes(':'));
  if (times.length && !used.some((n) => times.includes(n))) return 'no-time';
  // «По графику Vuelo» без времени — ссылка на план ни о чём.
  if (/график\S* vuelo/.test(lower) && !/\d?\d:\d\d/.test(text)) return 'vague';
  return null;
}

/** Что сказать модели, когда просим переписать. */
const RETRY_TEXT = {
  format: 'Нужен только текст Лиса — два предложения, без рассуждений. Ответь ещё раз.',
  short: 'Слишком коротко: нужны мнение о причине и одно действие. Ответь ещё раз.',
  long: 'Длиннее 190 символов. Сократи до двух коротких предложений и ответь ещё раз.',
  vague: 'Расплывчато. Скажи о причине из наблюдения и о действии из «Что предложить» с его временем. Ответь ещё раз.',
  numbers: 'В ответе числа не из «Что предложить». Числа можно только оттуда. Ответь ещё раз.',
  'no-time': 'Назови действие из «Что предложить» вместе с его временем. Ответь ещё раз.',
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
function count(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function duration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}
/** «7:20» — длительность сна. */
function hm(min) {
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
}
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

/** Текст для модели: кто человек и одно наблюдение дня — что видно, причина, что предложить. */
function buildUserText(p, seen = observe(p)) {
  const lines = [
    `Сейчас: ${MODE_TEXT[p.mode]}, ${p.time}.`,
    personLine(p.profile),
    'Наблюдение дня (Vuelo выбрал его по числам кольца):',
    `Что видно: ${seen.facts.join('; ')}.`,
    `Причина: ${seen.cause || 'не видна — не додумывай, скажи только о том, что видно'}.`,
    `Что предложить: ${seen.action || 'одно простое действие по теме наблюдения на ближайшие часы'}.`,
  ];
  if (p.recent.length) lines.push(`Недавние мнения (не повторяй их слова): ${p.recent.map((t) => `— ${t}`).join(' ')}`);
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

  const seen = observe(payload);
  // Ответ не подошёл (длинный, расплывчатый, чужие числа, нет времени действия) — один раз просим
  // переписать, если приложение ещё ждёт. Не вышло — 502, приложение оставит шаблонный совет.
  const started = Date.now();
  const messages = [
    { role: 'system', text: SYSTEM_PROMPT },
    { role: 'user', text: buildUserText(payload, seen) },
  ];
  let problem = 'empty';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const left = DEADLINE_MS - (Date.now() - started);
    if (attempt > 0 && left < RETRY_MIN_MS) break;
    const result = await askModel({ token, folder, model, messages, timeoutMs: Math.min(LLM_TIMEOUT_MS, left) });
    if (result.status) return reply(result.status, { error: result.error });
    const text = parseAnswer(result.text);
    problem = text ? answerProblem(text, seen.action) : 'format';
    if (!problem) return reply(200, { text, finding: seen.id });
    // Причина — в лог функции без текста ответа: видно, как часто модель промахивается.
    console.warn('answer rejected', problem, 'attempt', attempt + 1);
    messages.push({ role: 'assistant', text: result.text }, { role: 'user', text: RETRY_TEXT[problem] });
  }
  return reply(502, { error: `answer ${problem}`, finding: seen.id });
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
        completionOptions: { stream: false, temperature: 0.5, maxTokens: '300' },
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

module.exports = { handler, validate, observe, buildUserText, parseAnswer, answerProblem, SYSTEM_PROMPT };
