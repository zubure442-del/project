import type { AdviceDay, MinutePoint } from './advice-days';
import type { ReportMode } from './report';

/**
 * Движок физиологии для «Мнения Лиса» (владелец 26.09): модель не умеет считать ряды — физиологию
 * считает код, а YandexGPT только пересказывает готовый вывод.
 *
 * Каждая система кольца даёт свой факт относительно СВОЕЙ нормы (средние за неделю):
 * - «сейчас» и «сегодня» (следствия): пульс и стресс за последний час, движение, давление, вариабельность
 *   и пульс покоя сегодня, сахар (скачет или ровный), шаги и активные калории к этому часу;
 * - «раньше» (причины): длительность, глубина и время сна, пульс во сне и когда он опустился, кислород
 *   ночью, вариабельность двух дней, стресс двух дней, нагрузка, тренировка и шаги вчера, поздний ужин,
 *   перекусы, недавняя еда, скачки сахара, статика или движение раньше сегодня, долг сна.
 * Причинно-следственная таблица (`CAUSES_FOR`) говорит, какая причина правдоподобно объясняет какое
 * следствие и насколько (вес). Связка = следствие × причина × вес; причины той же системы запрещены
 * (статику не объясняем статикой). Сказанное в этом цикле не повторяется, пока есть другое.
 *
 * Прежняя версия брала «что с телом сейчас» только из пульса, шагов и стресса за час, а остальные
 * системы — лишь при сильном отклонении: в обычный день находилась одна связка, и Лис говорил только
 * про пульс (владелец 26.09: «ты смеёшься надо мной?»).
 *
 * Фразы — простым разговорным языком, без цифр и диагнозов; давление и сахар — «выше обычного», «скачет».
 */

/** Следствия — что с телом сейчас или сегодня. */
export type BodyState =
  | 'idle'
  | 'tense-still'
  | 'saving'
  | 'exertion'
  | 'still'
  | 'moving'
  | 'fade'
  | 'tense'
  | 'calm-now'
  | 'pressure-up'
  | 'pressure-down'
  | 'hrv-low'
  | 'hrv-high'
  | 'rest-up'
  | 'rest-down'
  | 'sugar-swing'
  | 'sugar-calm'
  | 'steps-ahead'
  | 'steps-behind'
  | 'burn-ahead'
  | 'burn-behind'
  | 'hrv-ok'
  | 'rest-ok'
  | 'pressure-ok'
  | 'sugar-ok'
  | 'steady';

/** Причины — что было раньше: ночь, вчера, последние дни, раньше сегодня. */
export type RootCause =
  | 'short-night'
  | 'long-night'
  | 'deep-debt'
  | 'good-night'
  | 'late-bed'
  | 'early-bed'
  | 'regular-bed'
  | 'night-pulse'
  | 'low-night-pulse'
  | 'late-recovery'
  | 'night-oxygen'
  | 'hrv-down'
  | 'hrv-up'
  | 'repair'
  | 'stress-days'
  | 'calm-days'
  | 'heavy-yesterday'
  | 'light-yesterday'
  | 'late-meal'
  | 'recent-meal'
  | 'snacking'
  | 'sugar-swings'
  | 'long-still'
  | 'active-earlier'
  | 'sleep-debt'
  | 'oxygen-ok'
  | 'past-bed-window'
  | 'past-dinner-plan'
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
  /** Верхнее давление и сахар по оценке кольца (записи 0x55 без выбросов). */
  systolic?: readonly MinutePoint[];
  glucose?: readonly MinutePoint[];
  /** Долг сна за последние ночи из «Режима сна», минуты; нет — null. */
  sleepDebtMin?: number | null;
  /**
   * План Vuelo из карточек: конец окна «Лечь спать» и время ужина (минуты от полуночи, ночь — больше 1440).
   * Изредка — причина («вчера легли позже окна, которое советует Vuelo»), никогда — призыв.
   */
  plan?: { bedTo: number | null; dinner: number | null };
  /** Ключи связок, о которых Лис уже говорил: за этот цикл и за неделю, свежие первыми. */
  said: { today: readonly string[]; week: readonly string[] };
}

export interface Insight {
  /** «hrv-low-late-meal»: запоминается в истории, чтобы Лис не повторялся. */
  key: string;
  state: BodyState;
  cause: RootCause;
  /** Что с телом сейчас или сегодня — простыми словами и без цифр. */
  consequence: string;
  /** Первопричина из истории кольца — без цифр. */
  rootCause: string;
  /** Сколько допустимых связок движок нашёл сейчас. */
  options: number;
  /** Для «Сырого лога»: что движок видит по каждой системе против нормы. Посреднику не уходит. */
  debug: string;
}

// ── Пороги ──────────────────────────────────────────────────────────────────────────────────────

/** «Холостой ход» — пульс на 15 % и больше выше СВОЕГО ОБЫЧНОГО ДНЁМ В ПОКОЕ почти без шагов (владелец 26.09). */
export const IDLE_PULSE_RATIO = 1.15;
/** «Почти без шагов» за час. */
export const STILL_STEPS_PER_HOUR = 100;
/** Экономный режим: пульс ниже обычного днём в покое на 5 % и больше, стресс в зоне «Низкий» (до 30). */
export const SAVING_PULSE_RATIO = 0.95;
export const SAVING_STRESS_MAX = 30;
/** Стресс «Повышенный» — от 61 (зоны стресса продукта). */
export const HIGH_STRESS_MIN = 61;
/** Нагрузка сейчас — пульс выше обычного днём на 30 % при движении. */
export const EXERTION_PULSE_RATIO = 1.3;
/** «Ровно» — пульс в пределах ±12 % от обычного днём в покое. */
export const STEADY_PULSE_BAND = 0.12;
/** Движение сейчас — от стольких шагов за последний час. */
export const MOVING_STEPS_PER_HOUR = 1500;
/** Затяжная статика — не меньше двух часов и меньше стольких шагов за них. */
export const STILL_MIN_HOURS = 2;
export const STILL_MAX_STEPS = 300;
/** Стресс «выше обычного» — на столько пунктов выше своей нормы; «ниже» — на CALM_NOW_UNDER ниже. */
export const STRESS_OVER = 15;
export const CALM_NOW_UNDER = 10;
/** Вечерний спад ищем не раньше этого часа. */
export const FADE_FROM_MIN = 17 * 60;
/** Много движения раньше сегодня — от стольких шагов за последние 4 ч. */
export const ACTIVE_EARLIER_STEPS = 4000;
/** Давление выше или ниже своей нормы — верхнее за последние 2 ч, мм рт. ст. */
export const PRESSURE_OVER = 8;
export const PRESSURE_WINDOW_MIN = 120;
/** Вариабельность сегодня против нормы — на 10 %. */
export const HRV_TREND_SHARE = 0.1;
/** Пульс покоя сегодня против нормы — на столько ударов. */
export const REST_PULSE_SHIFT = 3;
/** Сахар ровный — размах меньше своего на 30 %; скачет — в полтора раза больше и от SUGAR_SWING_MIN. */
export const SUGAR_CALM_RATIO = 0.7;
export const SUGAR_SWING_RATIO = 1.5;
export const SUGAR_SWING_MIN = 1.5;
/** Шаги и калории к этому часу: больше обычного в 1.3 раза или меньше 0.6 от обычного; сравниваем от DAY_PACE_MIN. */
export const PACE_AHEAD = 1.3;
export const PACE_BEHIND = 0.6;
export const DAY_PACE_END = 22 * 60;
export const DAY_PACE_MIN_STEPS = 1500;

/** Короткая или длинная ночь — на столько минут от своей нормы. */
export const SHORT_NIGHT_MIN = 45;
/** Долг глубокого сна за две ночи — от стольких минут; сильный — от DEEP_DEBT_STRONG_MIN. */
export const DEEP_DEBT_MIN = 20;
export const DEEP_DEBT_STRONG_MIN = 40;
/** Пульс во сне выше нормы — на столько ударов; ниже — на NIGHT_PULSE_UNDER. */
export const NIGHT_PULSE_OVER = 4;
export const NIGHT_PULSE_UNDER = 3;
/** Позднее восстановление: первая половина сна выше второй на столько ударов. */
export const LATE_RECOVERY_DROP = 5;
export const NIGHT_HEART_MIN = 4;
/** Кислород ночью ниже своей нормы на столько процентов; без нормы — ниже NIGHT_SPO2_LOW. */
export const NIGHT_SPO2_DROP = 1.5;
export const NIGHT_SPO2_LOW = 95;
/** Стресс двух дней выше нормы на столько пунктов; спокойные дни — ниже на CALM_DAYS_UNDER. */
export const STRESS_DAYS_OVER = 10;
export const CALM_DAYS_UNDER = 5;
/** Отбой позже или раньше привычного на столько минут; «привычное время» — в пределах REGULAR_BED_MIN. */
export const LATE_BED_MIN = 60;
export const EARLY_BED_MIN = 45;
export const REGULAR_BED_MIN = 20;
/** Поздний ужин — последний приём пищи не раньше чем за столько минут до сна. */
export const LATE_MEAL_BEFORE_SLEEP_MIN = 150;
/** Вечерняя нагрузка вчера — от стольких шагов с 19:00 до сна. */
export const EVENING_LOAD_STEPS = 3000;
/** Недавний приём пищи: от 20 до 120 мин назад; сильнее всего отклик через 30–60 минут. */
export const RECENT_MEAL_MIN = 120;
export const RECENT_MEAL_SKIP_MIN = 20;
export const MEAL_PEAK_FROM_MIN = 30;
export const MEAL_PEAK_TO_MIN = 60;
/** Перекусов больше обычного — на столько приёмов больше своей нормы и не меньше SNACKING_MIN. */
export const SNACKING_OVER = 1;
export const SNACKING_MIN = 4;
/** Тяжёлый вчерашний день — TRIMP в 1.5 раза или шаги в 1.4 раза выше обычного; лёгкий — вдвое ниже. */
export const HEAVY_LOAD_RATIO = 1.5;
export const HEAVY_STEPS_RATIO = 1.4;
export const LIGHT_DAY_RATIO = 0.5;
/** Отбой или ужин позже плана Vuelo — на столько минут. */
export const PLAN_LATE_MIN = 30;
/** Долг сна из «Режима сна» — от стольких минут. */
export const SLEEP_DEBT_MIN = 60;
/** Своей нормы нет, пока дней с данными меньше этого. */
export const BASELINE_MIN_DAYS = 3;
/**
 * О чём уже говорили на этой неделе — вес связки ×0.25; причина уже звучала в этом цикле — ×0.4.
 * Связка, сказанная в этом цикле, не повторяется вовсе, пока есть другая (`findInsight`).
 */
const SAID_WEEK_FACTOR = 0.25;
const SAID_TODAY_FACTOR = 0.4;

// ── Причинно-следственная таблица: какая причина объясняет какое следствие и насколько ─────────

type Weights = Partial<Record<RootCause, number>>;
const NIGHT_BAD: Weights = {
  'short-night': 1, 'deep-debt': 0.9, 'late-bed': 0.8, 'night-pulse': 0.8, 'late-recovery': 0.9, 'night-oxygen': 0.8, 'sleep-debt': 0.9,
  'past-bed-window': 0.8,
};
const NIGHT_GOOD: Weights = { 'good-night': 0.9, 'long-night': 0.7, 'low-night-pulse': 0.7, 'regular-bed': 0.6, 'early-bed': 0.6, 'oxygen-ok': 0.5 };
/**
 * «В норме» — тоже факт (владелец 26.09: «почему только пульс?»): в спокойный день Лис проходит по всем
 * системам. Объясняется хорошей или обычной ночью, спокойными днями — или «несмотря на» плохую ночь.
 */
const OK_CAUSES: Weights = {
  ...NIGHT_GOOD, 'usual-night': 0.5, 'calm-days': 0.7, 'hrv-up': 0.6, 'active-earlier': 0.5,
  'short-night': 0.4, 'deep-debt': 0.4, 'sleep-debt': 0.4, 'late-bed': 0.4, 'past-bed-window': 0.4, 'heavy-yesterday': 0.4,
};

/**
 * Следствие ← причины с весом правдоподобия. Причины той же системы не берём: статику не объясняем
 * статикой, движение — движением, вариабельность — вариабельностью.
 */
export const CAUSES_FOR: Record<BodyState, Weights> = {
  idle: { ...NIGHT_BAD, 'recent-meal': 1.2, 'hrv-down': 0.9, 'stress-days': 0.8, 'heavy-yesterday': 0.7, snacking: 0.6, 'sugar-swings': 0.7 },
  'tense-still': { ...NIGHT_BAD, 'stress-days': 1, 'hrv-down': 0.9, 'sugar-swings': 0.7 },
  saving: { ...NIGHT_BAD, ...NIGHT_GOOD, 'recent-meal': 1, 'active-earlier': 1, 'heavy-yesterday': 0.9, repair: 1, 'hrv-up': 0.7, 'sugar-swings': 0.6, snacking: 0.6 },
  exertion: { ...NIGHT_GOOD, 'hrv-up': 0.7, 'heavy-yesterday': 0.6, 'short-night': 0.6, 'deep-debt': 0.6, 'calm-days': 0.5 },
  still: { ...NIGHT_BAD, 'heavy-yesterday': 0.8, repair: 0.9, 'hrv-down': 0.7 },
  moving: { ...NIGHT_GOOD, 'hrv-up': 0.8, 'calm-days': 0.6, 'light-yesterday': 0.6 },
  fade: { ...NIGHT_BAD, 'hrv-down': 0.9, 'heavy-yesterday': 0.8, repair: 0.9, 'late-meal': 0.7, 'past-dinner-plan': 0.6, snacking: 0.8, 'sugar-swings': 0.8 },
  tense: { ...NIGHT_BAD, 'stress-days': 1, 'hrv-down': 0.9, 'late-meal': 0.6, 'long-still': 0.8, 'sugar-swings': 0.8 },
  'calm-now': { ...NIGHT_GOOD, 'hrv-up': 0.9, 'calm-days': 0.8, 'active-earlier': 0.8 },
  'pressure-up': { ...NIGHT_BAD, 'stress-days': 0.9, 'long-still': 0.7, snacking: 0.5, 'late-meal': 0.5 },
  'pressure-down': { ...NIGHT_GOOD, 'calm-days': 0.6, 'active-earlier': 0.6, 'hrv-up': 0.6 },
  'hrv-low': { ...NIGHT_BAD, 'heavy-yesterday': 1, repair: 1.1, 'late-meal': 0.9, 'past-dinner-plan': 0.7, 'stress-days': 0.8 },
  'hrv-high': { ...NIGHT_GOOD, 'calm-days': 0.8, 'light-yesterday': 0.7 },
  // Пульс покоя берётся из той же ночи, что и пульс во сне, — ночным пульсом его не объясняем.
  'rest-up': { ...NIGHT_BAD, 'night-pulse': 0, 'late-recovery': 0, 'heavy-yesterday': 0.9, 'late-meal': 0.9, 'past-dinner-plan': 0.7, 'stress-days': 0.8, 'hrv-down': 0.7 },
  'rest-down': { ...NIGHT_GOOD, 'low-night-pulse': 0, 'usual-night': 0.4, 'calm-days': 0.7, 'hrv-up': 0.7, 'light-yesterday': 0.6 },
  'sugar-swing': { snacking: 1, 'late-meal': 0.6, 'short-night': 0.8, 'deep-debt': 0.7, 'sleep-debt': 0.7, 'long-still': 0.7, 'stress-days': 0.6 },
  'sugar-calm': { ...NIGHT_GOOD, 'active-earlier': 0.8, 'calm-days': 0.5 },
  'steps-ahead': { ...NIGHT_GOOD, 'hrv-up': 0.8, 'calm-days': 0.6, 'light-yesterday': 0.6 },
  'steps-behind': { ...NIGHT_BAD, 'heavy-yesterday': 0.8, repair: 0.8, 'hrv-down': 0.7, 'stress-days': 0.6 },
  'burn-ahead': { ...NIGHT_GOOD, 'hrv-up': 0.8, 'light-yesterday': 0.6 },
  'burn-behind': { ...NIGHT_BAD, 'heavy-yesterday': 0.8, repair: 0.8, 'hrv-down': 0.7 },
  'hrv-ok': { ...OK_CAUSES, 'hrv-up': 0 },
  'rest-ok': { ...OK_CAUSES, 'low-night-pulse': 0 },
  'pressure-ok': OK_CAUSES,
  'sugar-ok': OK_CAUSES,
  // Ровный день после плохой ночи — тоже связка: тело держится, несмотря на недосып (вес ниже).
  steady: {
    ...NIGHT_GOOD, 'hrv-up': 0.8, 'calm-days': 0.8, 'active-earlier': 0.6, 'usual-night': 0.5,
    'short-night': 0.4, 'deep-debt': 0.4, 'sleep-debt': 0.4, 'late-bed': 0.4, 'past-bed-window': 0.4, 'heavy-yesterday': 0.4,
  },
};

/** Следствия «сейчас» (последний час) — между собой согласованы: «ровно» только без остальных. */
const NOW_STATES = new Set<BodyState>(['idle', 'tense-still', 'saving', 'exertion', 'still', 'moving', 'fade', 'tense', 'calm-now', 'steady']);

/** Утром важнее ночь и восстановление, вечером — итоги дня: множитель следствия по отрезку. */
const MODE_WEIGHT: Partial<Record<BodyState, Partial<Record<ReportMode, number>>>> = {
  'hrv-low': { morning: 1.3, evening: 0.8 },
  'hrv-high': { morning: 1.3, evening: 0.8 },
  'rest-up': { morning: 1.3, evening: 0.8 },
  'rest-down': { morning: 1.3, evening: 0.8 },
  'steps-ahead': { morning: 0.5, evening: 1.2 },
  'steps-behind': { morning: 0.4, evening: 1.2 },
  'burn-ahead': { morning: 0.5, evening: 1.2 },
  'burn-behind': { morning: 0.4, evening: 1.2 },
};

// ── Фразы: [умеренно, сильно]. Простой разговорный язык, без канцелярита и цифр ─────────────────

type Pair = readonly [string, string];
const same = (pair: Pair): Record<ReportMode, Pair> => ({ morning: pair, day: pair, evening: pair });

export const STATE_TEXT: Record<BodyState, Record<ReportMode, Pair>> = {
  idle: {
    morning: ['С утра пульс чуть выше обычного, хотя вы почти не двигаетесь', 'С утра пульс заметно выше обычного, хотя вы почти не двигаетесь'],
    day: ['Пульс сейчас чуть выше обычного, хотя вы почти не двигаетесь', 'Пульс сейчас заметно выше обычного, хотя вы почти не двигаетесь'],
    evening: ['Вечером пульс не опускается, хотя вы почти не двигаетесь', 'Вечером пульс заметно выше обычного, хотя движения почти нет'],
  },
  'tense-still': {
    morning: ['С утра стресс высокий, а вы почти не двигаетесь', 'С утра стресс очень высокий, а движения почти нет'],
    day: ['Стресс сейчас высокий, а вы почти не двигаетесь', 'Стресс сейчас очень высокий, а движения почти нет'],
    evening: ['Вечером стресс высокий, а вы почти не двигаетесь', 'Вечером стресс очень высокий, а движения почти нет'],
  },
  saving: {
    morning: ['Утро идёт в экономном режиме: пульс низкий, стресса почти нет', 'Утро идёт в очень экономном режиме, тело бережёт силы'],
    day: ['Тело сейчас экономит силы: пульс низкий, стресса почти нет', 'Тело сейчас сильно экономит силы, пульс и стресс на минимуме'],
    evening: ['Вечером тело экономит силы: пульс низкий, стресса почти нет', 'Вечером тело сильно экономит силы, пульс и стресс на минимуме'],
  },
  exertion: {
    morning: ['С утра пульс высокий, тело сейчас в нагрузке', 'С утра пульс очень высокий, тело в серьёзной нагрузке'],
    day: ['Пульс сейчас высокий, тело в нагрузке', 'Пульс сейчас очень высокий, тело в серьёзной нагрузке'],
    evening: ['Вечером пульс высокий, тело в нагрузке', 'Вечером пульс очень высокий, тело в серьёзной нагрузке'],
  },
  still: {
    morning: ['С утра вы почти не двигались', 'С утра прошло уже несколько часов почти без движения'],
    day: ['Последние часы вы почти не двигаетесь', 'Уже несколько часов почти без движения'],
    evening: ['Вечер проходит почти без движения', 'Весь вечер почти без движения'],
  },
  moving: {
    morning: ['Утро началось с хорошего движения', 'Утро идёт бодро, вы много двигаетесь'],
    day: ['Вы сейчас в движении, и пульс легко подстраивается', 'Вы сейчас много двигаетесь, и пульс легко успевает'],
    evening: ['Вечером вы ещё в движении', 'Вечер идёт бодро, движения много'],
  },
  fade: {
    morning: ['Стресс растёт, а движения становится меньше', 'Стресс заметно растёт, а движения почти нет'],
    day: ['Ближе к вечеру стресс растёт, а движения мало', 'Ближе к вечеру стресс заметно вырос, а сил меньше'],
    evening: ['К вечеру стресс растёт, а сил становится меньше', 'К вечеру стресс заметно вырос, а сил заметно меньше'],
  },
  tense: {
    morning: ['С утра стресс выше вашего обычного', 'С утра стресс заметно выше вашего обычного'],
    day: ['Стресс сейчас выше вашего обычного', 'Стресс сейчас заметно выше вашего обычного'],
    evening: ['Вечером стресс выше вашего обычного', 'Вечером стресс заметно выше вашего обычного'],
  },
  'calm-now': {
    morning: ['С утра стресс ниже вашего обычного', 'С утра стресс заметно ниже вашего обычного'],
    day: ['Стресс сейчас ниже вашего обычного', 'Стресс сейчас заметно ниже вашего обычного'],
    evening: ['Вечером стресс ниже вашего обычного', 'Вечером стресс заметно ниже вашего обычного'],
  },
  'pressure-up': {
    morning: ['С утра давление держится выше вашего обычного', 'С утра давление заметно выше вашего обычного'],
    day: ['Давление сейчас держится выше вашего обычного', 'Давление сейчас заметно выше вашего обычного'],
    evening: ['Вечером давление держится выше вашего обычного', 'Вечером давление заметно выше вашего обычного'],
  },
  'pressure-down': same(['Давление сейчас ниже вашего обычного', 'Давление сейчас заметно ниже вашего обычного']),
  'hrv-low': same(['Вариабельность пульса сегодня ниже вашей нормы', 'Вариабельность пульса сегодня заметно ниже вашей нормы']),
  'hrv-high': same(['Вариабельность пульса сегодня выше вашей нормы', 'Вариабельность пульса сегодня заметно выше вашей нормы']),
  'rest-up': same(['Пульс покоя сегодня выше вашего обычного', 'Пульс покоя сегодня заметно выше вашего обычного']),
  'rest-down': same(['Пульс покоя сегодня ниже вашего обычного', 'Пульс покоя сегодня заметно ниже вашего обычного']),
  'sugar-swing': same(['Сахар сегодня скачет сильнее обычного', 'Сахар сегодня скачет заметно сильнее обычного']),
  'sugar-calm': same(['Сахар сегодня держится ровнее обычного', 'Сахар сегодня держится заметно ровнее обычного']),
  'steps-ahead': same(['Шагов сегодня уже больше, чем обычно к этому часу', 'Шагов сегодня уже намного больше, чем обычно к этому часу']),
  'steps-behind': same(['Шагов сегодня пока меньше, чем обычно к этому часу', 'Шагов сегодня пока намного меньше, чем обычно к этому часу']),
  'burn-ahead': same(['Активных калорий сегодня уже больше, чем обычно к этому часу', 'Активных калорий сегодня уже намного больше обычного']),
  'burn-behind': same(['Активных калорий сегодня пока меньше, чем обычно к этому часу', 'Активных калорий сегодня пока намного меньше обычного']),
  'hrv-ok': same(['Вариабельность пульса сегодня в вашей обычной норме', 'Вариабельность пульса сегодня точно в вашей норме']),
  'rest-ok': same(['Пульс покоя сегодня как обычно', 'Пульс покоя сегодня точно как обычно']),
  'pressure-ok': same(['Давление сегодня держится в вашем обычном коридоре', 'Давление сегодня ровное, как обычно']),
  'sugar-ok': same(['Сахар сегодня держится в вашем обычном коридоре', 'Сахар сегодня ровный, как обычно']),
  steady: {
    morning: ['Утро идёт ровно: пульс и стресс в вашей норме', 'Утро идёт ровно, тело в хорошей форме'],
    day: ['День идёт ровно: пульс и стресс в вашей норме', 'День идёт ровно, тело держит хорошую форму'],
    evening: ['Вечер проходит ровно, пульс и стресс в норме', 'Вечер проходит ровно, тело в хорошей форме'],
  },
};

export const CAUSE_TEXT: Record<RootCause, Pair> = {
  'short-night': ['Прошлой ночью вы спали меньше обычного', 'Прошлой ночью вы спали заметно меньше обычного'],
  'long-night': ['Прошлой ночью вы спали дольше обычного', 'Прошлой ночью вы спали заметно дольше обычного'],
  'deep-debt': ['Две последние ночи глубокого сна было меньше обычного', 'Две ночи подряд глубокого сна заметно меньше вашей нормы'],
  'good-night': ['Ночь была полноценной, с хорошим глубоким сном', 'Ночь была длинной и глубокой, лучше обычной'],
  'late-bed': ['Прошлой ночью вы легли позже обычного', 'Прошлой ночью вы легли намного позже обычного'],
  'early-bed': ['Прошлой ночью вы легли раньше обычного', 'Прошлой ночью вы легли намного раньше обычного'],
  'regular-bed': ['Вы легли спать в своё привычное время', 'Вы легли спать точно в своё привычное время'],
  'night-pulse': ['Ночью пульс был выше вашего обычного', 'Ночью пульс был заметно выше вашего обычного'],
  'low-night-pulse': ['Ночью пульс опускался ниже вашего обычного', 'Ночью пульс опускался заметно ниже обычного, тело хорошо отдохнуло'],
  'late-recovery': ['Ночью пульс опустился до обычного только под утро', 'Ночью пульс долго не опускался и успокоился только под утро'],
  'night-oxygen': ['Ночью кислород в крови был ниже вашего обычного', 'Ночью кислород в крови заметно проседал'],
  'hrv-down': ['Последние два дня тело восстанавливается хуже обычного', 'Последние два дня тело восстанавливается заметно хуже обычного'],
  'hrv-up': ['Последние два дня тело восстанавливается лучше обычного', 'Последние два дня тело восстанавливается заметно лучше обычного'],
  repair: ['После вчерашней нагрузки тело сегодня восстанавливает мышцы', 'Вчерашняя нагрузка была большой, и тело сегодня чинит мышцы'],
  'stress-days': ['Стресс держится выше обычного уже второй день', 'Два дня подряд стресс заметно выше вашего обычного'],
  'calm-days': ['Последние два дня стресс ниже вашего обычного', 'Последние два дня стресс заметно ниже вашего обычного'],
  'heavy-yesterday': ['Вчера нагрузка была больше обычной', 'Вчера нагрузка была заметно больше обычной'],
  'light-yesterday': ['Вчера нагрузки было меньше обычного, тело отдохнуло', 'Вчера нагрузки было намного меньше обычного'],
  'late-meal': ['Вчера вы поели незадолго до сна', 'Вчера вы поели совсем незадолго до сна'],
  'recent-meal': ['Недавно была еда, и тело занято перевариванием', 'Совсем недавно была еда, и тело занято перевариванием'],
  snacking: ['Сегодня перекусов больше, чем обычно', 'Сегодня перекусов заметно больше, чем обычно'],
  'sugar-swings': ['Сахар сегодня скачет сильнее обычного', 'Сахар сегодня скачет заметно сильнее обычного'],
  'long-still': ['Последние часы прошли почти без движения', 'Уже несколько часов подряд почти без движения'],
  'active-earlier': ['Раньше сегодня было много движения', 'Сегодня уже было очень много движения'],
  'sleep-debt': ['За последние ночи накопился долг сна', 'За последние ночи накопился заметный долг сна'],
  'oxygen-ok': ['Ночью кислород в крови держался ровно', 'Ночью кислород в крови держался ровно, как обычно'],
  'past-bed-window': ['Прошлой ночью вы легли позже окна, которое советует Vuelo', 'Прошлой ночью вы легли намного позже окна, которое советует Vuelo'],
  'past-dinner-plan': ['Вчера ужин был позже, чем советует Vuelo', 'Вчера ужин был намного позже, чем советует Vuelo'],
  'usual-night': ['Ночь прошла как обычно', 'Ночь прошла как обычно, без отклонений'],
};

/** Уточнённые фразы, когда данные позволяют сказать точнее. */
export const CAUSE_DETAIL = {
  workout: {
    cardio: 'Вчера была кардиотренировка, тело ещё восстанавливается',
    strength: 'Вчера была силовая тренировка, мышцы ещё восстанавливаются',
  },
  repairAfterWorkout: 'Вчерашняя тренировка была тяжёлой, и тело сегодня восстанавливает мышцы',
  lateRecoveryAfterMeal: 'После позднего ужина пульс ночью опустился только под утро',
  lateRecoveryAfterLoad: 'После вечерней нагрузки пульс ночью опустился только под утро',
  oxygenLongSleep: 'Сон был долгим, но кислород в крови ночью проседал',
  snackingYesterday: 'Вчера перекусов было больше, чем обычно',
} as const;

// ── Расчёт ──────────────────────────────────────────────────────────────────────────────────────

const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const nums = (values: readonly (number | null)[]) => values.filter((v): v is number => v !== null);
const clockMin = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Время отхода ко сну как минуты вечера: после полуночи — больше 1440, чтобы 00:30 было позже 23:30. */
const bedMin = (clock: string) => {
  const m = clockMin(clock);
  return m < 12 * 60 ? m + 1440 : m;
};
const cap = (v: number) => Math.min(2, v);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

type Found<K> = { key: K; strength: number; text?: string };

/** Своя норма по дням `from..to` (ago), если дней с данными хватает. */
function norm(days: readonly AdviceDay[], pick: (d: AdviceDay) => number | null, from: number, to: number, min = BASELINE_MIN_DAYS) {
  const values = nums(days.filter((d) => d.ago >= from && d.ago <= to).map(pick));
  return values.length >= min ? mean(values) : null;
}

const inWindow = (points: readonly MinutePoint[], from: number, to: number) => points.filter((p) => p.m > from && p.m <= to);
const sum = (points: readonly MinutePoint[]) => points.reduce((a, p) => a + p.v, 0);

/** Обычный пульс днём в покое: медиана по прошлым дням (от двух), иначе — по сегодняшним замерам. */
export const dayPulseOf = (days: readonly AdviceDay[]) =>
  norm(days, (d) => d.quietPulse, 1, 7, 2) ?? days.find((d) => d.ago === 0)?.quietPulse ?? null;
const restingOf = (days: readonly AdviceDay[]) =>
  norm(days, (d) => d.restingPulse, 1, 7, 1) ?? days.find((d) => d.ago === 0)?.restingPulse ?? null;

/** Всё, что движок сравнивает, в одном месте: и для расчёта, и для строки в «Сыром логе». */
function readings(input: PhysioInput) {
  const { now, days } = input;
  const d0 = days.find((d) => d.ago === 0) ?? null;
  const wake = d0?.awake ? clockMin(d0.awake) : null;
  const midFrom = Math.max(now - 240, wake ?? now - 240);
  // Доля дня к этому часу — для шагов и калорий «к этому часу»: от подъёма до 22:00.
  const pace = wake !== null ? clamp01((now - wake) / (DAY_PACE_END - wake)) : null;
  const sugar = (input.glucose ?? []).filter((p) => p.m >= 0 && p.m <= now).map((p) => p.v);
  return {
    d0,
    wake,
    midFrom,
    pace,
    pulse: mean(inWindow(input.heart, now - 90, now).map((p) => p.v)),
    stress: mean(inWindow(input.stress, now - 90, now).map((p) => p.v)),
    stepsNow: sum(inWindow(input.steps, now - 60, now)),
    stepsMid: sum(inWindow(input.steps, midFrom, now)),
    systolic: mean(inWindow(input.systolic ?? [], now - PRESSURE_WINDOW_MIN, now).map((p) => p.v)),
    sugarRange: sugar.length >= 3 ? Math.max(...sugar) - Math.min(...sugar) : null,
    dayPulse: dayPulseOf(days),
    rest: restingOf(days),
    norms: {
      stress: norm(days, (d) => d.stress, 1, 7),
      systolic: norm(days, (d) => d.systolic, 1, 7),
      hrv: norm(days, (d) => d.hrv, 1, 7),
      restingPulse: norm(days, (d) => d.restingPulse, 1, 7),
      sugarRange: norm(days, (d) => d.glucoseRange, 1, 7),
      steps: norm(days, (d) => d.steps, 1, 7),
      calories: norm(days, (d) => d.calories, 1, 7),
      sleep: norm(days, (d) => d.sleepMin, 1, 7),
      deep: norm(days, (d) => d.deepMin, 2, 7),
      nightPulse: norm(days, (d) => d.nightPulse, 1, 7),
      nightSpo2: norm(days, (d) => d.nightSpo2, 1, 7),
      bed: norm(days, (d) => (d.asleep ? bedMin(d.asleep) : null), 1, 7),
    },
  };
}

/** Следствия: что с телом сейчас (последний час) и сегодня (по каждой системе против своей нормы). */
export function bodyStates(input: PhysioInput): Found<BodyState>[] {
  const { now } = input;
  const r = readings(input);
  const { pulse, stress, stepsNow, dayPulse: base, d0, norms } = r;
  const out: Found<BodyState>[] = [];
  const push = (key: BodyState, strength: number) => out.push({ key, strength: cap(strength) });

  // Сейчас: пульс против обычного днём в покое, стресс, движение.
  const quiet = stepsNow < STILL_STEPS_PER_HOUR;
  if (quiet && base !== null && pulse !== null && pulse >= base * IDLE_PULSE_RATIO) push('idle', (pulse / base - 1) / (IDLE_PULSE_RATIO - 1));
  if (quiet && stress !== null && stress >= HIGH_STRESS_MIN) push('tense-still', 1 + (stress - HIGH_STRESS_MIN) / 20);
  if (quiet && base !== null && pulse !== null && pulse <= base * SAVING_PULSE_RATIO && (stress === null || stress <= SAVING_STRESS_MAX)) push('saving', 1);
  if (!quiet && base !== null && pulse !== null && pulse >= base * EXERTION_PULSE_RATIO) push('exertion', (pulse / base - 1) / (EXERTION_PULSE_RATIO - 1));
  if ((now - r.midFrom) / 60 >= STILL_MIN_HOURS && r.stepsMid < STILL_MAX_STEPS) push('still', (now - r.midFrom) / 60 / STILL_MIN_HOURS);
  if (stepsNow >= MOVING_STEPS_PER_HOUR) push('moving', stepsNow / MOVING_STEPS_PER_HOUR);
  if (now >= FADE_FROM_MIN && r.wake !== null && stress !== null && stepsNow < MOVING_STEPS_PER_HOUR / 3 && now - r.wake >= 360) {
    const morning = mean(inWindow(input.stress, r.wake, r.wake + 240).map((p) => p.v));
    if (morning !== null && stress >= morning + STRESS_OVER) push('fade', (stress - morning) / STRESS_OVER);
  }
  if (!quiet && stress !== null && norms.stress !== null && stress >= norms.stress + STRESS_OVER) push('tense', (stress - norms.stress) / STRESS_OVER);
  if (stress !== null && norms.stress !== null && stress <= norms.stress - CALM_NOW_UNDER) push('calm-now', 0.6 + (norms.stress - stress) / (CALM_NOW_UNDER * 3));
  // «Ровно» — только когда больше ничего «сейчас» не видно и пульс рядом с обычным.
  const pulseUsual = pulse === null || base === null || Math.abs(pulse / base - 1) <= STEADY_PULSE_BAND;
  if (!out.length && pulseUsual && (pulse !== null || stress !== null)) push('steady', 0.3);

  // Сегодня: давление, вариабельность, пульс покоя, сахар, шаги и калории к этому часу.
  if (r.systolic !== null && norms.systolic !== null) {
    if (r.systolic >= norms.systolic + PRESSURE_OVER) push('pressure-up', (r.systolic - norms.systolic) / PRESSURE_OVER);
    if (r.systolic <= norms.systolic - PRESSURE_OVER) push('pressure-down', 0.7 * (norms.systolic - r.systolic) / PRESSURE_OVER);
  }
  if (d0?.hrv != null && norms.hrv !== null && norms.hrv > 0) {
    const change = d0.hrv / norms.hrv - 1;
    if (change <= -HRV_TREND_SHARE) push('hrv-low', -change / (HRV_TREND_SHARE * 1.5));
    if (change >= HRV_TREND_SHARE) push('hrv-high', change / (HRV_TREND_SHARE * 1.5));
  }
  if (d0?.restingPulse != null && norms.restingPulse !== null) {
    const diff = d0.restingPulse - norms.restingPulse;
    if (diff >= REST_PULSE_SHIFT) push('rest-up', diff / (REST_PULSE_SHIFT * 1.5));
    if (diff <= -REST_PULSE_SHIFT) push('rest-down', -diff / (REST_PULSE_SHIFT * 1.5));
  }
  if (r.sugarRange !== null && norms.sugarRange !== null && norms.sugarRange > 0) {
    if (r.sugarRange >= Math.max(SUGAR_SWING_MIN, norms.sugarRange * SUGAR_SWING_RATIO)) push('sugar-swing', r.sugarRange / (norms.sugarRange * SUGAR_SWING_RATIO * 1.2));
    if (r.sugarRange <= norms.sugarRange * SUGAR_CALM_RATIO) push('sugar-calm', 0.6 + (1 - r.sugarRange / norms.sugarRange));
  }
  const pace = (value: number | null | undefined, usual: number | null, ahead: BodyState, behind: BodyState, min: number) => {
    if (value == null || usual === null || r.pace === null) return;
    const expected = usual * r.pace;
    if (expected < min) return;
    if (value >= expected * PACE_AHEAD) push(ahead, value / expected / PACE_AHEAD);
    if (value <= expected * PACE_BEHIND) push(behind, PACE_BEHIND / Math.max(0.1, value / expected));
  };
  pace(d0?.steps, norms.steps, 'steps-ahead', 'steps-behind', DAY_PACE_MIN_STEPS);
  pace(d0?.calories, norms.calories, 'burn-ahead', 'burn-behind', 50);

  // Системы без отклонения — «в норме», со слабым весом: отклонения всегда впереди.
  const has = (...keys: BodyState[]) => out.some((s) => keys.includes(s.key));
  if (d0?.hrv != null && norms.hrv !== null && !has('hrv-low', 'hrv-high')) push('hrv-ok', OK_STRENGTH);
  if (d0?.restingPulse != null && norms.restingPulse !== null && !has('rest-up', 'rest-down')) push('rest-ok', OK_STRENGTH);
  if (r.systolic !== null && norms.systolic !== null && !has('pressure-up', 'pressure-down')) push('pressure-ok', OK_STRENGTH);
  if (r.sugarRange !== null && norms.sugarRange !== null && !has('sugar-swing', 'sugar-calm')) push('sugar-ok', OK_STRENGTH);
  return out;
}

/** Сила факта «в норме»: ниже любого отклонения. */
const OK_STRENGTH = 0.25;

/** Кандидаты в первопричину — из ночи, вчерашнего дня, последних дней и раньше сегодня. */
export function rootCauses(input: PhysioInput): Found<RootCause>[] {
  const { now, days } = input;
  const r = readings(input);
  const { norms } = r;
  const day = (ago: number) => days.find((d) => d.ago === ago) ?? null;
  const d0 = day(0);
  const d1 = day(1);
  const out: Found<RootCause>[] = [];
  const push = (key: RootCause, strength: number, text?: string) => out.push({ key, strength: cap(strength), ...(text ? { text } : {}) });

  // Ночь: длительность, глубина, время отхода, пульс во сне и когда он опустился, кислород.
  if (d0?.sleepMin != null && norms.sleep !== null) {
    if (d0.sleepMin <= norms.sleep - SHORT_NIGHT_MIN) push('short-night', (norms.sleep - d0.sleepMin) / 60);
    if (d0.sleepMin >= norms.sleep + SHORT_NIGHT_MIN) push('long-night', 0.6 + (d0.sleepMin - norms.sleep) / 120);
  }
  const deepNights = nums([d0?.deepMin ?? null, d1?.deepMin ?? null]);
  if (norms.deep !== null && deepNights.length) {
    const debt = deepNights.reduce((a, v) => a + Math.max(0, (norms.deep as number) - v), 0);
    if (debt >= DEEP_DEBT_MIN) push('deep-debt', debt / DEEP_DEBT_STRONG_MIN);
  }
  const deepGood = norms.deep === null || (d0?.deepMin != null && d0.deepMin >= norms.deep);
  if (d0?.sleepMin != null && norms.sleep !== null && d0.sleepMin >= norms.sleep && deepGood) push('good-night', 0.8);
  const bed = d0?.asleep ? bedMin(d0.asleep) : null;
  if (bed !== null && norms.bed !== null) {
    if (bed - norms.bed >= LATE_BED_MIN) push('late-bed', (bed - norms.bed) / (LATE_BED_MIN * 1.5));
    if (norms.bed - bed >= EARLY_BED_MIN) push('early-bed', 0.6 + (norms.bed - bed) / 180);
    if (Math.abs(bed - norms.bed) <= REGULAR_BED_MIN) push('regular-bed', 0.4);
  }
  if (d0?.nightPulse != null && norms.nightPulse !== null) {
    if (d0.nightPulse - norms.nightPulse >= NIGHT_PULSE_OVER) push('night-pulse', (d0.nightPulse - norms.nightPulse) / (NIGHT_PULSE_OVER * 1.5));
    if (norms.nightPulse - d0.nightPulse >= NIGHT_PULSE_UNDER) push('low-night-pulse', 0.5 + (norms.nightPulse - d0.nightPulse) / (NIGHT_PULSE_UNDER * 4));
  }
  const lastMeal = d1?.meals.length ? Math.max(...d1.meals.map(clockMin)) : null;
  const lateMeal = lastMeal !== null && bed !== null && bed - lastMeal >= 0 && bed - lastMeal <= LATE_MEAL_BEFORE_SLEEP_MIN;
  if (lateMeal) push('late-meal', 1);
  if (bed !== null && r.wake !== null) {
    const from = bed - 1440;
    const night = input.heart.filter((p) => p.m >= from && p.m <= (r.wake as number));
    const mid = (from + r.wake) / 2;
    const first = mean(night.filter((p) => p.m < mid).map((p) => p.v));
    const second = mean(night.filter((p) => p.m >= mid).map((p) => p.v));
    if (night.length >= NIGHT_HEART_MIN && first !== null && second !== null && first - second >= LATE_RECOVERY_DROP && (r.rest === null || first >= r.rest)) {
      const eveningSteps = sum(inWindow(input.steps, 19 * 60 - 1440, from));
      const text = lateMeal
        ? CAUSE_DETAIL.lateRecoveryAfterMeal
        : eveningSteps >= EVENING_LOAD_STEPS || d1?.workout
          ? CAUSE_DETAIL.lateRecoveryAfterLoad
          : undefined;
      push('late-recovery', (first - second) / (LATE_RECOVERY_DROP * 1.2) + (text ? 0.3 : 0), text);
    }
  }
  if (d0?.nightSpo2 != null) {
    const drop = norms.nightSpo2 !== null ? norms.nightSpo2 - d0.nightSpo2 : null;
    const low = drop !== null ? drop >= NIGHT_SPO2_DROP : d0.nightSpo2 < NIGHT_SPO2_LOW;
    if (low) {
      const longSleep = d0.sleepMin != null && norms.sleep !== null && d0.sleepMin >= norms.sleep;
      const strength = drop !== null ? drop / (NIGHT_SPO2_DROP * 1.5) : 1;
      push('night-oxygen', longSleep ? strength * 1.2 : strength, longSleep ? CAUSE_DETAIL.oxygenLongSleep : undefined);
    }
  }
  if (d0?.nightSpo2 != null && norms.nightSpo2 !== null && Math.abs(d0.nightSpo2 - norms.nightSpo2) < 1) push('oxygen-ok', 0.4);
  // Долг сна копится неделями и у многих держится постоянно (спит человек шесть часов, а нужно
  // семь с половиной): не даём ему перебивать всё. Прошлая ночь не короче обычной — он ещё слабее.
  if (input.sleepDebtMin != null && input.sleepDebtMin >= SLEEP_DEBT_MIN) {
    const lastNightShort = d0?.sleepMin != null && norms.sleep !== null && d0.sleepMin < norms.sleep - SHORT_NIGHT_MIN / 2;
    push('sleep-debt', Math.min(lastNightShort ? 0.9 : 0.5, input.sleepDebtMin / 240));
  }
  // План Vuelo — изредка как причина: легли позже окна «Режима сна», ужин позже «Цикла питания».
  const plan = input.plan;
  if (plan?.bedTo != null && bed !== null && bed - plan.bedTo >= PLAN_LATE_MIN) push('past-bed-window', 0.6 + (bed - plan.bedTo) / 180);
  if (plan?.dinner != null && lastMeal !== null && lastMeal - plan.dinner >= PLAN_LATE_MIN) push('past-dinner-plan', 0.6 + (lastMeal - plan.dinner) / 180);
  if (d0?.sleepMin != null) push('usual-night', 0.2);

  // Последние дни: стресс и вариабельность двух дней против недели до них.
  const stressRecent = norm(days, (d) => d.stress, 1, 2, 2);
  const stressWeek = norm(days, (d) => d.stress, 3, 7);
  if (stressRecent !== null && stressWeek !== null) {
    if (stressRecent >= stressWeek + STRESS_DAYS_OVER) push('stress-days', (stressRecent - stressWeek) / (STRESS_DAYS_OVER * 1.5));
    if (stressRecent <= stressWeek - CALM_DAYS_UNDER) push('calm-days', 0.5 + (stressWeek - stressRecent) / (CALM_DAYS_UNDER * 4));
  }
  const hrvWeek = norm(days, (d) => d.hrv, 2, 7);
  const hrvRecent = norm(days, (d) => d.hrv, 0, 1, 1);
  if (hrvRecent !== null && hrvWeek !== null && hrvWeek > 0) {
    const change = hrvRecent / hrvWeek - 1;
    if (change <= -HRV_TREND_SHARE) push('hrv-down', -change / (HRV_TREND_SHARE * 1.5));
    if (change >= HRV_TREND_SHARE) push('hrv-up', change / (HRV_TREND_SHARE * 1.5));
  }

  // Вчера: нагрузка по пульсу (TRIMP), тренировка, шаги. С просевшей вариабельностью — восстановление мышц.
  const loadWeek = norm(days, (d) => d.load, 2, 7);
  const stepsWeek = norm(days, (d) => d.steps, 2, 7);
  let heavy = 0;
  if (d1?.workout) heavy = 1;
  if (d1?.load != null && loadWeek !== null && loadWeek > 0 && d1.load >= loadWeek * HEAVY_LOAD_RATIO) heavy = Math.max(heavy, d1.load / (loadWeek * HEAVY_LOAD_RATIO));
  if (d1?.steps != null && stepsWeek !== null && stepsWeek > 0 && d1.steps >= stepsWeek * HEAVY_STEPS_RATIO) heavy = Math.max(heavy, d1.steps / (stepsWeek * HEAVY_STEPS_RATIO));
  if (heavy > 0) push('heavy-yesterday', heavy, d1?.workout ? CAUSE_DETAIL.workout[d1.workout] : undefined);
  const lightLoad = d1?.load != null && loadWeek !== null && loadWeek > 0 && d1.load <= loadWeek * LIGHT_DAY_RATIO;
  const lightSteps = d1?.steps != null && stepsWeek !== null && stepsWeek > 0 && d1.steps <= stepsWeek * LIGHT_DAY_RATIO;
  if (!heavy && !d1?.workout && (lightLoad || lightSteps)) push('light-yesterday', 0.6);
  if (heavy > 0 && d0?.hrv != null && hrvWeek !== null && hrvWeek > 0 && d0.hrv <= hrvWeek * (1 - HRV_TREND_SHARE)) {
    const drop = 1 - d0.hrv / hrvWeek;
    push('repair', heavy * 0.6 + drop / (HRV_TREND_SHARE * 1.5), d1?.workout ? CAUSE_DETAIL.repairAfterWorkout : undefined);
    // Связка двух систем говорит больше, чем каждая по отдельности.
    for (const c of out) if (c.key === 'heavy-yesterday' || c.key === 'hrv-down') c.strength *= 0.5;
  }

  // Еда и сахар: недавний приём (сильнее всего через 30–60 минут), перекусы, скачки сахара.
  const ago = (d0?.meals ?? []).map((m) => now - clockMin(m)).filter((a) => a >= RECENT_MEAL_SKIP_MIN && a <= RECENT_MEAL_MIN);
  if (ago.length) push('recent-meal', ago.some((a) => a >= MEAL_PEAK_FROM_MIN && a <= MEAL_PEAK_TO_MIN) ? 1.5 : 1);
  const mealsWeek = norm(days, (d) => (d.meals.length ? d.meals.length : null), 1, 7);
  if (mealsWeek !== null) {
    if (d0 && d0.meals.length >= Math.max(SNACKING_MIN, mealsWeek + SNACKING_OVER)) push('snacking', (d0.meals.length - mealsWeek) / 2);
    else if (d1 && d1.meals.length >= Math.max(SNACKING_MIN, mealsWeek + SNACKING_OVER + 1)) push('snacking', (d1.meals.length - mealsWeek) / 3, CAUSE_DETAIL.snackingYesterday);
  }
  if (r.sugarRange !== null && norms.sugarRange !== null && r.sugarRange >= Math.max(SUGAR_SWING_MIN, norms.sugarRange * SUGAR_SWING_RATIO)) {
    push('sugar-swings', r.sugarRange / (norms.sugarRange * SUGAR_SWING_RATIO * 1.2));
  }

  // Раньше сегодня: статика или много движения.
  const midTo = now - 60;
  if (midTo - r.midFrom >= STILL_MIN_HOURS * 60 && sum(inWindow(input.steps, r.midFrom, midTo)) < STILL_MAX_STEPS) {
    push('long-still', (midTo - r.midFrom) / (STILL_MIN_HOURS * 60));
  }
  const normMet = d0?.steps != null && d0.stepNorm != null && d0.steps >= d0.stepNorm;
  if (r.stepsMid >= ACTIVE_EARLIER_STEPS || normMet) push('active-earlier', normMet ? 1.2 : 1);
  return oneSide(out);
}

/**
 * Причины с противоположным смыслом по одной теме: оставляем сторону с самым сильным отклонением.
 * Иначе по кнопке Лис говорил «накопился долг сна», а следом — «ночь была полноценной» (26.09).
 */
const SIDES: readonly [readonly RootCause[], readonly RootCause[]][] = [
  [
    // Долга сна (копится неделями) здесь нет: он не спорит с тем, что прошлая ночь была обычной.
    ['short-night', 'deep-debt', 'late-bed', 'past-bed-window', 'night-pulse', 'late-recovery', 'night-oxygen'],
    ['good-night', 'long-night', 'early-bed', 'regular-bed', 'low-night-pulse', 'oxygen-ok', 'usual-night'],
  ],
  [['stress-days'], ['calm-days']],
  [['hrv-down', 'repair'], ['hrv-up']],
  [['heavy-yesterday', 'repair'], ['light-yesterday']],
];

function oneSide(causes: Found<RootCause>[]): Found<RootCause>[] {
  const drop = new Set<RootCause>();
  const top = (keys: readonly RootCause[]) => Math.max(0, ...causes.filter((c) => keys.includes(c.key)).map((c) => c.strength));
  for (const [bad, good] of SIDES) {
    const b = top(bad);
    const g = top(good);
    if (b > 0 && g > 0) for (const k of b >= g ? good : bad) drop.add(k);
  }
  return causes.filter((c) => !drop.has(c.key));
}

/** Строка для «Сырого лога»: что движок видит по каждой системе против нормы. Только на телефоне. */
function debugLine(input: PhysioInput): string {
  const r = readings(input);
  const n = (v: number | null | undefined, digits = 0) => (v == null ? '—' : digits ? v.toFixed(digits) : String(Math.round(v)));
  const pair = (label: string, v: number | null | undefined, usual: number | null, digits = 0) => `${label} ${n(v, digits)} (обычно ${n(usual, digits)})`;
  const d0 = r.d0;
  return [
    pair('пульс сейчас', r.pulse, r.dayPulse),
    pair('стресс', r.stress, r.norms.stress),
    `шагов за час ${r.stepsNow}`,
    pair('сон, мин', d0?.sleepMin, r.norms.sleep),
    pair('глубокий', d0?.deepMin, r.norms.deep),
    pair('пульс во сне', d0?.nightPulse, r.norms.nightPulse),
    pair('пульс покоя', d0?.restingPulse, r.norms.restingPulse),
    pair('вариабельность', d0?.hrv, r.norms.hrv),
    pair('кислород ночью', d0?.nightSpo2, r.norms.nightSpo2),
    pair('давление', r.systolic, r.norms.systolic),
    pair('размах сахара', r.sugarRange, r.norms.sugarRange, 1),
    pair('шаги за день', d0?.steps, r.norms.steps),
    pair('активные ккал', d0?.calories, r.norms.calories),
    `приёмов пищи ${d0?.meals.length ?? '—'}`,
    `долг сна ${n(input.sleepDebtMin)} мин`,
  ].join('; ');
}

/**
 * Темы: «мало шагов», «мало калорий» и «давно без движения» — одна мысль (владелец 26.09: «повторяет всё
 * из раза в раз»). Ротация идёт по темам следствий и причин, а не по ключам.
 */
const STATE_TOPIC: Record<BodyState, string> = {
  still: 'move', moving: 'move', exertion: 'move', 'steps-ahead': 'move', 'steps-behind': 'move', 'burn-ahead': 'move', 'burn-behind': 'move',
  idle: 'pulse', saving: 'pulse', steady: 'pulse', 'rest-up': 'rest', 'rest-down': 'rest', 'rest-ok': 'rest',
  'tense-still': 'stress', tense: 'stress', 'calm-now': 'stress', fade: 'stress',
  'pressure-up': 'pressure', 'pressure-down': 'pressure', 'pressure-ok': 'pressure',
  'hrv-low': 'hrv', 'hrv-high': 'hrv', 'hrv-ok': 'hrv',
  'sugar-swing': 'sugar', 'sugar-calm': 'sugar', 'sugar-ok': 'sugar',
};
const CAUSE_TOPIC: Record<RootCause, string> = {
  'short-night': 'sleep', 'long-night': 'sleep', 'deep-debt': 'sleep', 'good-night': 'sleep', 'usual-night': 'sleep', 'sleep-debt': 'debt',
  'late-bed': 'bedtime', 'early-bed': 'bedtime', 'regular-bed': 'bedtime', 'past-bed-window': 'bedtime',
  'night-pulse': 'night-heart', 'low-night-pulse': 'night-heart', 'late-recovery': 'night-heart',
  'night-oxygen': 'oxygen', 'oxygen-ok': 'oxygen',
  'hrv-down': 'recovery', 'hrv-up': 'recovery', repair: 'recovery',
  'stress-days': 'stress', 'calm-days': 'stress',
  'heavy-yesterday': 'load', 'light-yesterday': 'load',
  'late-meal': 'food', 'recent-meal': 'food', snacking: 'food', 'sugar-swings': 'food', 'past-dinner-plan': 'food',
  'long-still': 'move', 'active-earlier': 'move',
};
/** План Vuelo как причина — не чаще раза за цикл (владелец 26.09: «не часто, но можно»). */
const PLAN_CAUSES = new Set<RootCause>(['past-bed-window', 'past-dinner-plan']);

/** Ключ связки → следствие и причина (в названиях есть дефисы — ищем известное следствие в начале). */
const STATES_BY_LENGTH = (Object.keys(STATE_TOPIC) as BodyState[]).sort((a, b) => b.length - a.length);
function splitKey(key: string): { state: BodyState; cause: RootCause } | null {
  const state = STATES_BY_LENGTH.find((s) => key.startsWith(`${s}-`));
  if (!state) return null;
  const cause = key.slice(state.length + 1) as RootCause;
  return cause in CAUSE_TOPIC ? { state, cause } : null;
}

/** Все допустимые связки по весу, самая яркая первой (с учётом того, о чём Лис уже говорил). */
export function rankInsights(input: PhysioInput): { state: Found<BodyState>; cause: Found<RootCause>; score: number }[] {
  const states = bodyStates(input);
  const causes = rootCauses(input);
  const pairs: { state: Found<BodyState>; cause: Found<RootCause>; score: number }[] = [];
  for (const state of states) {
    const weights = CAUSES_FOR[state.key];
    const modeWeight = MODE_WEIGHT[state.key]?.[input.mode] ?? 1;
    for (const cause of causes) {
      const w = weights[cause.key];
      if (!w) continue;
      const key = `${state.key}-${cause.key}`;
      let score = state.strength * cause.strength * w * modeWeight;
      if (input.said.week.includes(key)) score *= SAID_WEEK_FACTOR;
      if (input.said.today.some((k) => splitKey(k)?.cause === cause.key)) score *= SAID_TODAY_FACTOR;
      if (PLAN_CAUSES.has(cause.key) && input.said.today.some((k) => PLAN_CAUSES.has(splitKey(k)?.cause as RootCause))) continue;
      pairs.push({ state, cause, score });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

/**
 * Доминантная связка «следствие ← первопричина». null — сказать нечего (нет ни одной пары):
 * тогда остаётся шаблонный совет.
 */
export function findInsight(input: PhysioInput): Insight | null {
  // Ротация по темам: сначала связка, где и следствие, и причина из тем, о которых в этом цикле
  // ещё не говорили; потом — где новая хотя бы одна; потом любая несказанная; потом самая давняя.
  const ranked = rankInsights(input);
  const keyOf = (p: (typeof ranked)[number]) => `${p.state.key}-${p.cause.key}`;
  const said = input.said.today.map(splitKey).filter((x): x is { state: BodyState; cause: RootCause } => x !== null);
  const saidStates = new Set(said.map((x) => STATE_TOPIC[x.state]));
  const saidCauses = new Set(said.map((x) => CAUSE_TOPIC[x.cause]));
  const fresh = (p: (typeof ranked)[number]) => !input.said.today.includes(keyOf(p));
  const newState = (p: (typeof ranked)[number]) => !saidStates.has(STATE_TOPIC[p.state.key]);
  const newCause = (p: (typeof ranked)[number]) => !saidCauses.has(CAUSE_TOPIC[p.cause.key]);
  const best =
    ranked.find((p) => fresh(p) && newState(p) && newCause(p)) ??
    ranked.find((p) => fresh(p) && (newState(p) || newCause(p))) ??
    ranked.find(fresh) ??
    [...ranked].sort((a, b) => input.said.today.indexOf(keyOf(b)) - input.said.today.indexOf(keyOf(a)))[0];
  if (!best) return null;
  const strong = (s: number) => (s >= 1.5 ? 1 : 0);
  const { state, cause } = best;
  return {
    key: keyOf(best),
    state: state.key,
    cause: cause.key,
    consequence: `${STATE_TEXT[state.key][input.mode][strong(state.strength)]}.`,
    rootCause: `${cause.text ?? CAUSE_TEXT[cause.key][strong(cause.strength)]}.`,
    options: ranked.length,
    debug: debugLine(input),
  };
}

/** Для тестов и документации: следствия «сейчас», между которыми «ровно» не выбирается. */
export const NOW_STATE_KEYS = NOW_STATES;
