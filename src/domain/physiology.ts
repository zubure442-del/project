import type { AdviceDay, MinutePoint } from './advice-days';
import type { ReportMode } from './report';

/**
 * Движок физиологии для «Мнения Лиса» (владелец 26.09, новая архитектура): модель не умеет считать
 * ряды — выходили тавтологии («мало двигались, потому что не ходили») и выдумки («загруженность
 * делами»). Теперь физиологию считает код, а YandexGPT только пересказывает готовый вывод голосом Лиса.
 *
 * Движок сопоставляет четыре временных слоя с личными нормами (свои средние за неделю):
 * - глубокий горизонт (48–72 ч): долг глубокого сна за две ночи, тренд вариабельности к недельной норме,
 *   фон напряжения два дня подряд;
 * - вчера и ночь (12–24 ч): длительность и время отхода ко сну, пульс во сне, нагрузка и тренировка
 *   вчера, поздний ужин перед сном;
 * - средний горизонт (2–4 ч): шаги по часам — затяжная статика или много движения, недавний приём пищи;
 * - оперативный срез (последние 60–90 мин): пульс против пульса покоя, шаги, фон напряжения.
 * Из оперативного среза получается состояние тела сейчас (`consequence`), из остальных слоёв —
 * кандидаты в первопричину (`root_cause`). Каждая пара «состояние × причина» получает вес (сила
 * состояния × сила причины), пары одной природы (статика ← статика) запрещены, о чём Лис уже говорил —
 * отодвигается. Побеждает одна доминантная связка; её фразы зависят от отрезка дня и силы отклонения.
 * Цифр в фразах нет. Значений глюкозы нет — только то, что недавно был приём пищи.
 */

export type BodyState = 'idle' | 'saving' | 'still' | 'moving' | 'fade' | 'tense' | 'steady';
export type RootCause =
  | 'deep-debt'
  | 'short-night'
  | 'night-pulse'
  | 'hrv-down'
  | 'hrv-up'
  | 'stress-days'
  | 'late-bed'
  | 'late-meal'
  | 'heavy-yesterday'
  | 'recent-meal'
  | 'long-still'
  | 'active-earlier'
  | 'good-night'
  | 'usual-night';

export interface PhysioInput {
  /** Отрезок цикла: после пробуждения, днём, перед сном — от него зависят слова. */
  mode: ReportMode;
  /** «Сейчас» — минута последней выгрузки от полуночи сегодняшнего дня. */
  now: number;
  /** Строки по дням (`adviceDay`), ago 0 — сегодня. */
  days: readonly AdviceDay[];
  /** Ряды вчера и сегодня на одной оси: минуты от полуночи сегодня, вчерашние — отрицательные. */
  heart: readonly MinutePoint[];
  steps: readonly MinutePoint[];
  stress: readonly MinutePoint[];
  /** Ключи связок, о которых Лис уже говорил: за этот цикл и за неделю. */
  said: { today: readonly string[]; week: readonly string[] };
}

export interface Insight {
  /** «idle-deep-debt»: запоминается в истории, чтобы Лис не повторялся. */
  key: string;
  state: BodyState;
  cause: RootCause;
  /** Что с телом сейчас — объективно и без цифр. */
  consequence: string;
  /** Первопричина из истории кольца — без цифр. */
  rootCause: string;
}

// ── Пороги ──────────────────────────────────────────────────────────────────────────────────────

/** «Холостой ход» — пульс выше покоя на 15 % и больше почти без шагов (владелец 26.09). */
export const IDLE_PULSE_RATIO = 1.15;
/** «Почти без шагов» за час. */
export const STILL_STEPS_PER_HOUR = 100;
/** «Режим сбережения сил»: пульс не выше покоя больше чем на 5 %, фон напряжения в зоне «Низкий» (до 30). */
export const SAVING_PULSE_RATIO = 1.05;
export const SAVING_STRESS_MAX = 30;
/** Фон напряжения «Повышенный» — от 61 (зоны стресса продукта): без шагов это тоже холостой ход. */
export const IDLE_STRESS_MIN = 61;
/** Движение сейчас — от стольких шагов за последний час (≈ четверть часа ходьбы). */
export const MOVING_STEPS_PER_HOUR = 1500;
/** Затяжная статика — не меньше двух часов и меньше стольких шагов за них. */
export const STILL_MIN_HOURS = 2;
export const STILL_MAX_STEPS = 300;
/** Фон напряжения «выше обычного» — на столько пунктов выше своей нормы (или утра, для вечернего спада). */
export const STRESS_OVER = 15;
/** Вечерний спад ищем не раньше этого часа. */
export const FADE_FROM_MIN = 17 * 60;
/** Много движения раньше в цикле — от стольких шагов за средний горизонт. */
export const ACTIVE_EARLIER_STEPS = 4000;

/** Короткая ночь — на столько минут короче своей нормы. */
export const SHORT_NIGHT_MIN = 45;
/** Долг глубокого сна за две ночи — от стольких минут; сильный — от DEEP_DEBT_STRONG_MIN. */
export const DEEP_DEBT_MIN = 20;
export const DEEP_DEBT_STRONG_MIN = 40;
/** Пульс во сне выше нормы — на столько ударов (как значимое отклонение в «Пульсе во сне»). */
export const NIGHT_PULSE_OVER = 4;
/** Тренд вариабельности — на 10 % от недельной нормы. */
export const HRV_TREND_SHARE = 0.1;
/** Фон напряжения два дня подряд выше нормы — на столько пунктов. */
export const STRESS_DAYS_OVER = 10;
/** Поздно уснул — на столько минут позже привычного. */
export const LATE_BED_MIN = 60;
/** Поздний ужин — последний приём пищи не раньше чем за столько минут до сна. */
export const LATE_MEAL_BEFORE_SLEEP_MIN = 150;
/** Недавний приём пищи — начался не раньше чем столько минут назад, но не только что. */
export const RECENT_MEAL_MIN = 150;
export const RECENT_MEAL_SKIP_MIN = 15;
/** Тяжёлый вчерашний день — нагрузка в полтора раза выше обычной. */
export const HEAVY_LOAD_RATIO = 1.5;
/** Своей нормы нет, пока дней с данными меньше этого. */
export const BASELINE_MIN_DAYS = 3;
/** О чём уже говорили на этой неделе — вес связки ×0.25; причина уже звучала в этом цикле — ×0.4. */
const SAID_WEEK_FACTOR = 0.25;
const SAID_TODAY_FACTOR = 0.4;

// ── Совместимость: какие причины объясняют какое состояние ─────────────────────────────────────

/**
 * Только причины другой природы, чем само состояние: статику не объясняем статикой, движение — движением.
 */
export const CAUSES_FOR: Record<BodyState, readonly RootCause[]> = {
  idle: ['recent-meal', 'short-night', 'deep-debt', 'night-pulse', 'hrv-down', 'late-bed', 'stress-days', 'long-still', 'heavy-yesterday'],
  saving: ['active-earlier', 'heavy-yesterday', 'hrv-up', 'good-night', 'deep-debt', 'short-night', 'usual-night'],
  still: ['short-night', 'deep-debt', 'heavy-yesterday', 'hrv-down', 'late-bed'],
  moving: ['good-night', 'hrv-up', 'usual-night'],
  fade: ['deep-debt', 'short-night', 'hrv-down', 'late-bed', 'night-pulse', 'heavy-yesterday', 'long-still', 'late-meal'],
  tense: ['stress-days', 'short-night', 'deep-debt', 'hrv-down', 'night-pulse', 'late-meal', 'late-bed'],
  steady: ['good-night', 'hrv-up', 'usual-night', 'active-earlier'],
};

// ── Фразы: [умеренно, сильно] ───────────────────────────────────────────────────────────────────

type Pair = readonly [string, string];

export const STATE_TEXT: Record<BodyState, Record<ReportMode, Pair>> = {
  idle: {
    morning: ['С утра тело спокойно, а внутри держится лёгкий разгон', 'С утра тело почти неподвижно, а пульс заметно выше покоя'],
    day: ['Сейчас тело в покое, а внутри держится лёгкий разгон', 'Сейчас движения почти нет, а пульс заметно выше покоя'],
    evening: ['Вечером тело отдыхает, а внутри ещё держится разгон', 'Вечером движения почти нет, а пульс заметно выше покоя'],
  },
  saving: {
    morning: ['Утро идёт в режиме сбережения сил: пульс низкий, фон спокойный', 'Утро идёт в глубоком режиме сбережения сил, тело спокойно'],
    day: ['Сейчас тело в режиме сбережения сил: пульс низкий, фон спокойный', 'Сейчас тело глубоко экономит силы, пульс и фон на минимуме'],
    evening: ['Вечером тело бережёт силы: пульс низкий, фон спокойный', 'Вечером тело глубоко экономит силы, пульс и фон на минимуме'],
  },
  still: {
    morning: ['С пробуждения тело почти не двигалось', 'С пробуждения прошло уже несколько часов почти без движения'],
    day: ['Последние часы тело почти не двигается', 'Уже несколько часов тело почти без движения'],
    evening: ['Вечер проходит почти без движения', 'Весь вечер тело почти без движения'],
  },
  moving: {
    morning: ['Утро началось с хорошего движения', 'Утро идёт в бодром темпе, тело много двигается'],
    day: ['Сейчас тело в движении, пульс спокойно идёт следом', 'Сейчас тело активно движется, и пульс легко подстраивается'],
    evening: ['Вечером тело ещё в движении', 'Вечер идёт в бодром темпе, движения много'],
  },
  fade: {
    morning: ['Фон напряжения растёт, а движения становится меньше', 'Фон напряжения заметно растёт, а движения почти нет'],
    day: ['Ближе к вечеру фон напряжения растёт, а движения мало', 'Ближе к вечеру фон напряжения заметно вырос, силы тают'],
    evening: ['К вечеру фон напряжения растёт, а силы понемногу тают', 'К вечеру фон напряжения заметно вырос, а силы тают'],
  },
  tense: {
    morning: ['С утра фон напряжения выше вашего обычного', 'С утра фон напряжения заметно выше вашего обычного'],
    day: ['Сейчас фон напряжения выше вашего обычного', 'Сейчас фон напряжения заметно выше вашего обычного'],
    evening: ['Вечером фон напряжения выше вашего обычного', 'Вечером фон напряжения заметно выше вашего обычного'],
  },
  steady: {
    morning: ['Утро идёт ровно: пульс и фон напряжения спокойные', 'Утро идёт ровно и спокойно, тело в хорошем тонусе'],
    day: ['День идёт ровно: пульс и фон напряжения в вашем коридоре', 'День идёт ровно, тело держит хороший тонус'],
    evening: ['Вечер проходит ровно, тело спокойно', 'Вечер проходит ровно, тело спокойно и в тонусе'],
  },
};

export const CAUSE_TEXT: Record<RootCause, Pair> = {
  'deep-debt': ['Глубокого сна за две последние ночи было меньше обычного', 'Две ночи подряд глубокого сна заметно меньше вашей нормы'],
  'short-night': ['Прошлая ночь была короче вашей обычной', 'Прошлая ночь вышла заметно короче вашей обычной'],
  'night-pulse': ['Ночью пульс во сне был выше вашей нормы', 'Ночью пульс во сне заметно не опускался до вашей нормы'],
  'hrv-down': ['Последние два дня тело восстанавливается хуже, чем обычно', 'Последние два дня восстановление заметно ниже недельной нормы'],
  'hrv-up': ['Последние два дня тело восстанавливается лучше обычного', 'Последние два дня восстановление заметно выше недельной нормы'],
  'stress-days': ['Фон напряжения держится выше обычного уже второй день', 'Два дня подряд фон напряжения заметно выше вашего обычного'],
  'late-bed': ['Прошлой ночью вы уснули позже привычного', 'Прошлой ночью вы уснули намного позже привычного'],
  'late-meal': ['Вчера последний приём пищи был незадолго до сна', 'Вчера последний приём пищи был совсем незадолго до сна'],
  'heavy-yesterday': ['Вчера нагрузка на тело была выше обычной', 'Вчера нагрузка на тело была заметно выше вашей обычной'],
  'recent-meal': ['Недавно был приём пищи, и тело занято перевариванием', 'Недавно был плотный приём пищи, тело занято перевариванием'],
  'long-still': ['Последние часы прошли почти без движения', 'Уже несколько часов подряд почти без движения'],
  'active-earlier': ['Раньше в этот день было много движения', 'Сегодня уже было очень много движения'],
  'good-night': ['Ночь была полноценной, с хорошей долей глубокого сна', 'Ночь была длинной и глубокой, лучше вашей обычной'],
  'usual-night': ['Ночь прошла в вашем обычном ритме', 'Ночь прошла в вашем обычном ритме, без отклонений'],
};

/** Вчерашняя тренировка — точнее, чем «нагрузка выше обычной». */
const WORKOUT_CAUSE: Record<'cardio' | 'strength', string> = {
  cardio: 'Вчера была кардиотренировка, тело ещё восстанавливается',
  strength: 'Вчера была силовая тренировка, мышцы ещё восстанавливаются',
};

// ── Расчёт ──────────────────────────────────────────────────────────────────────────────────────

const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const nums = (values: readonly (number | null)[]) => values.filter((v): v is number => v !== null);
const clockMin = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Время отхода ко сну как минуты вечера: после полуночи — больше 1440, чтобы 00:30 было позже 23:30. */
const bedMin = (clock: string) => {
  const m = clockMin(clock);
  return m < 12 * 60 ? m + 1440 : m;
};

type Found<K> = { key: K; strength: number; text?: string };

/** Своя норма по дням `from..to` (ago), если дней с данными хватает. */
function norm(days: readonly AdviceDay[], pick: (d: AdviceDay) => number | null, from: number, to: number, min = BASELINE_MIN_DAYS) {
  const values = nums(days.filter((d) => d.ago >= from && d.ago <= to).map(pick));
  return values.length >= min ? mean(values) : null;
}

const inWindow = (points: readonly MinutePoint[], from: number, to: number) => points.filter((p) => p.m > from && p.m <= to);

/** Состояние тела сейчас по оперативному срезу и среднему горизонту. */
export function bodyStates(input: PhysioInput): Found<BodyState>[] {
  const { now, days } = input;
  const today = days.find((d) => d.ago === 0);
  const rest = norm(days, (d) => d.restingPulse, 1, 7, 1) ?? today?.restingPulse ?? null;
  const pulse = mean(inWindow(input.heart, now - 90, now).map((p) => p.v));
  const stress = mean(inWindow(input.stress, now - 90, now).map((p) => p.v));
  const stepsNow = inWindow(input.steps, now - 60, now).reduce((a, p) => a + p.v, 0);
  const wake = today?.awake ? clockMin(today.awake) : null;
  const midFrom = Math.max(now - 240, wake ?? now - 240);
  const midHours = (now - midFrom) / 60;
  const stepsMid = inWindow(input.steps, midFrom, now).reduce((a, p) => a + p.v, 0);
  const out: Found<BodyState>[] = [];

  const quiet = stepsNow < STILL_STEPS_PER_HOUR;
  if (quiet && rest !== null && pulse !== null && pulse >= rest * IDLE_PULSE_RATIO) {
    out.push({ key: 'idle', strength: Math.min(2, (pulse / rest - 1) / (IDLE_PULSE_RATIO - 1)) });
  } else if (quiet && stress !== null && stress >= IDLE_STRESS_MIN) {
    out.push({ key: 'idle', strength: Math.min(2, stress / IDLE_STRESS_MIN) });
  }
  if (quiet && rest !== null && pulse !== null && pulse <= rest * SAVING_PULSE_RATIO && (stress === null || stress <= SAVING_STRESS_MAX)) {
    out.push({ key: 'saving', strength: 1 });
  }
  if (midHours >= STILL_MIN_HOURS && stepsMid < STILL_MAX_STEPS) {
    out.push({ key: 'still', strength: Math.min(2, midHours / STILL_MIN_HOURS) });
  }
  if (stepsNow >= MOVING_STEPS_PER_HOUR) out.push({ key: 'moving', strength: Math.min(2, stepsNow / MOVING_STEPS_PER_HOUR) });
  if (now >= FADE_FROM_MIN && wake !== null && stress !== null && stepsNow < MOVING_STEPS_PER_HOUR / 3) {
    const morning = mean(inWindow(input.stress, wake, wake + 240).map((p) => p.v));
    if (morning !== null && now - wake >= 360 && stress >= morning + STRESS_OVER) {
      out.push({ key: 'fade', strength: Math.min(2, (stress - morning) / STRESS_OVER) });
    }
  }
  const stressNorm = norm(days, (d) => d.stress, 1, 7);
  if (!quiet && stress !== null && stressNorm !== null && stress >= stressNorm + STRESS_OVER) {
    out.push({ key: 'tense', strength: Math.min(2, (stress - stressNorm) / STRESS_OVER) });
  }
  // Ровный фон — запасное состояние, когда за последний час есть хоть какие-то замеры.
  if (pulse !== null || stress !== null) out.push({ key: 'steady', strength: 0.3 });
  return out;
}

/** Кандидаты в первопричину — из ночи, вчерашнего дня и глубокого горизонта. */
export function rootCauses(input: PhysioInput): Found<RootCause>[] {
  const { now, days } = input;
  const day = (ago: number) => days.find((d) => d.ago === ago) ?? null;
  const d0 = day(0);
  const d1 = day(1);
  const out: Found<RootCause>[] = [];

  // Глубокий горизонт: долг глубокого сна за две ночи против нормы за неделю до них.
  const deepNorm = norm(days, (d) => d.deepMin, 2, 7);
  const deepNights = nums([d0?.deepMin ?? null, d1?.deepMin ?? null]);
  if (deepNorm !== null && deepNights.length) {
    const debt = deepNights.reduce((a, v) => a + Math.max(0, deepNorm - v), 0);
    if (debt >= DEEP_DEBT_MIN) out.push({ key: 'deep-debt', strength: Math.min(2, debt / DEEP_DEBT_STRONG_MIN) });
  }
  // Тренд вариабельности: два последних дня против недели до них.
  const hrvNow = norm(days, (d) => d.hrv, 0, 1, 1);
  const hrvNorm = norm(days, (d) => d.hrv, 2, 7);
  if (hrvNow !== null && hrvNorm !== null && hrvNorm > 0) {
    const change = hrvNow / hrvNorm - 1;
    if (change <= -HRV_TREND_SHARE) out.push({ key: 'hrv-down', strength: Math.min(2, -change / (HRV_TREND_SHARE * 1.5)) });
    if (change >= HRV_TREND_SHARE) out.push({ key: 'hrv-up', strength: Math.min(2, change / (HRV_TREND_SHARE * 1.5)) });
  }
  // Фон напряжения два дня подряд выше нормы.
  const stressRecent = norm(days, (d) => d.stress, 1, 2, 2);
  const stressNorm = norm(days, (d) => d.stress, 3, 7);
  if (stressRecent !== null && stressNorm !== null && stressRecent >= stressNorm + STRESS_DAYS_OVER) {
    out.push({ key: 'stress-days', strength: Math.min(2, (stressRecent - stressNorm) / (STRESS_DAYS_OVER * 1.5)) });
  }

  // Ночь: длительность, пульс во сне, время отхода ко сну.
  const sleepNorm = norm(days, (d) => d.sleepMin, 1, 7);
  if (d0?.sleepMin != null && sleepNorm !== null && d0.sleepMin <= sleepNorm - SHORT_NIGHT_MIN) {
    out.push({ key: 'short-night', strength: Math.min(2, (sleepNorm - d0.sleepMin) / 60) });
  }
  const pulseNorm = norm(days, (d) => d.nightPulse, 1, 7);
  if (d0?.nightPulse != null && pulseNorm !== null && d0.nightPulse - pulseNorm >= NIGHT_PULSE_OVER) {
    out.push({ key: 'night-pulse', strength: Math.min(2, (d0.nightPulse - pulseNorm) / (NIGHT_PULSE_OVER * 1.5)) });
  }
  const bedNorm = norm(days, (d) => (d.asleep ? bedMin(d.asleep) : null), 1, 7);
  const bed = d0?.asleep ? bedMin(d0.asleep) : null;
  if (bed !== null && bedNorm !== null && bed - bedNorm >= LATE_BED_MIN) {
    out.push({ key: 'late-bed', strength: Math.min(2, (bed - bedNorm) / (LATE_BED_MIN * 1.5)) });
  }
  const deepGood = deepNorm === null || (d0?.deepMin != null && d0.deepMin >= deepNorm);
  if (d0?.sleepMin != null && sleepNorm !== null && d0.sleepMin >= sleepNorm && deepGood) {
    out.push({ key: 'good-night', strength: 0.8 });
  }
  if (d0?.sleepMin != null) out.push({ key: 'usual-night', strength: 0.2 });

  // Вчерашний день: нагрузка и тренировка, поздний ужин.
  const loadNorm = norm(days, (d) => d.load, 2, 7);
  if (d1?.workout) {
    out.push({ key: 'heavy-yesterday', strength: 1, text: WORKOUT_CAUSE[d1.workout] });
  } else if (d1?.load != null && loadNorm !== null && loadNorm > 0 && d1.load >= loadNorm * HEAVY_LOAD_RATIO) {
    out.push({ key: 'heavy-yesterday', strength: Math.min(2, d1.load / (loadNorm * HEAVY_LOAD_RATIO)) });
  }
  const lastMeal = d1?.meals.length ? Math.max(...d1.meals.map(clockMin)) : null;
  if (lastMeal !== null && bed !== null && bed - lastMeal >= 0 && bed - lastMeal <= LATE_MEAL_BEFORE_SLEEP_MIN) {
    out.push({ key: 'late-meal', strength: 1 });
  }

  // Средний горизонт сегодня: недавний приём пищи, статика или много движения.
  const meals = (d0?.meals ?? []).map(clockMin).filter((m) => m <= now - RECENT_MEAL_SKIP_MIN && m >= now - RECENT_MEAL_MIN);
  if (meals.length) out.push({ key: 'recent-meal', strength: 1 });
  const wake = d0?.awake ? clockMin(d0.awake) : null;
  const midFrom = Math.max(now - 240, wake ?? now - 240);
  const midTo = now - 60;
  if (midTo - midFrom >= STILL_MIN_HOURS * 60) {
    const steps = inWindow(input.steps, midFrom, midTo).reduce((a, p) => a + p.v, 0);
    if (steps < STILL_MAX_STEPS) out.push({ key: 'long-still', strength: Math.min(2, (midTo - midFrom) / (STILL_MIN_HOURS * 60)) });
  }
  const stepsEarlier = inWindow(input.steps, midFrom, now).reduce((a, p) => a + p.v, 0);
  const normMet = d0?.steps != null && d0.stepNorm != null && d0.steps >= d0.stepNorm;
  if (stepsEarlier >= ACTIVE_EARLIER_STEPS || normMet) out.push({ key: 'active-earlier', strength: normMet ? 1.2 : 1 });
  return out;
}

/**
 * Доминантная связка «состояние сейчас ← первопричина». null — сказать нечего (нет замеров
 * за последний час или нет ни одной подходящей причины): тогда остаётся шаблонный совет.
 */
export function findInsight(input: PhysioInput): Insight | null {
  const states = bodyStates(input);
  const causes = rootCauses(input);
  let best: { state: Found<BodyState>; cause: Found<RootCause>; score: number } | null = null;
  for (const state of states) {
    for (const cause of causes) {
      if (!CAUSES_FOR[state.key].includes(cause.key)) continue;
      const key = `${state.key}-${cause.key}`;
      let score = state.strength * cause.strength;
      if (input.said.week.includes(key)) score *= SAID_WEEK_FACTOR;
      if (input.said.today.some((k) => k.endsWith(`-${cause.key}`))) score *= SAID_TODAY_FACTOR;
      if (!best || score > best.score) best = { state, cause, score };
    }
  }
  if (!best) return null;
  const strong = (s: number) => (s >= 1.5 ? 1 : 0);
  const { state, cause } = best;
  return {
    key: `${state.key}-${cause.key}`,
    state: state.key,
    cause: cause.key,
    consequence: `${STATE_TEXT[state.key][input.mode][strong(state.strength)]}.`,
    rootCause: `${cause.text ?? CAUSE_TEXT[cause.key][strong(cause.strength)]}.`,
  };
}
