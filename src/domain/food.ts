/**
 * «Цикл питания»: когда сегодня удобнее есть и сколько времени организм провёл без еды.
 *
 * Ночная глюкоза (замеры внутри сна, когда не было активности) за последние семь дней даёт
 * личную норму «натощак» — медиану, она устойчивее среднего к одиночным выбросам. Сегодняшняя
 * ночная глюкоза сравнивается с этой нормой, а вместе с индексом «Сон» выбирает режим дня.
 * Расписание строится от времени пробуждения. Не медицинская рекомендация и не диагноз.
 */
import { STEP_MIN_PER_MIN } from './score';
import { NOT_MEDICAL_DEVICE, pluralRu } from './texts';

/** Окно личной нормы «глюкозы натощак»: последние семь дней. */
export const FOOD_BASELINE_DAYS = 7;
/** Меньше стольких ночных замеров за окно — нормы нет, с чем сравнивать неизвестно. */
export const FOOD_BASELINE_MIN_READINGS = 3;
/** Коридор нормы: от −10 % до +25 % личной нормы. */
export const FOOD_NORM_LOW_SHARE = -0.1;
export const FOOD_NORM_HIGH_SHARE = 0.25;
/** Выше этого индекса «Сон» ночь считается восстановившей. */
export const FOOD_SLEEP_OK = 70;
/** Точку отсчёта голодания ищем в эти часы перед засыпанием. */
export const FASTING_LOOKBACK_HOURS = 4;
/** Часы аутофагии начинаются после этого времени без еды. */
export const AUTOPHAGY_AFTER_HOURS = 12;
/** Замер считается ночным, если рядом (± эти минуты) не было активных минут. */
export const FOOD_QUIET_WINDOW_MIN = 5;

/**
 * Расписание приёмов пищи, часы от пробуждения. Где в задании диапазон, берём его середину:
 * одно время на экране понятнее, чем «с 12:30 до 13:00», а разброс всё равно условный.
 */
export const FOOD_SCHEDULE = {
  base: { first: 5, gapAfterFirst: 5.5 },
  hyper: { first: 5, second: 10 },
  recovery: { first: [1, 1.5], lunch: [6, 7], dinner: [11, 12] },
} as const;

export type FoodMode = 'base' | 'recovery' | 'hyper';

/** Названия режимов. Длинного объяснения на карточке нет: место дороже. */
export const FOOD_MODE: Record<FoodMode, { title: string }> = {
  base: { title: 'Базовый режим' },
  recovery: { title: 'Режим восстановления' },
  hyper: { title: 'Подозрение на гипергликемию' },
};

/** Фиксированный текст кнопки «i» рядом со счётчиком аутофагии. Про пользу, без формул и чисел. */
export const AUTOPHAGY_INFO = {
  title: 'Что такое аутофагия',
  text:
    'Аутофагия — естественная уборка внутри клеток: в паузе между приёмами пищи организм разбирает ' +
    'и пускает в дело накопившийся внутренний мусор. В меру это полезно — и «Цикл питания» помогает ' +
    'держать эту меру.\n\n' +
    'Каждый день мы смотрим на ваш сон и ночные показатели и подбираем режим. Организм восстановился — ' +
    'оставляем спокойную паузу и два приёма пищи, чтобы уборка успела пройти. Не восстановился — паузу ' +
    'убираем и предлагаем есть чаще: в такие дни организму нужнее силы, а не голодание.\n\n' +
    'Счётчик показывает, сколько длится сегодняшняя пауза. ' + NOT_MEDICAL_DEVICE,
} as const;

/** Медиана: устойчивее среднего к одиночным выбросам. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Ночная глюкоза дня: замеры внутри фазы сна, вокруг которых не было активных минут.
 * Отрезки сна до полуночи (отрицательные минуты) относятся к предыдущему дню, поэтому здесь
 * берётся только часть ночи после полуночи — та же, по которой считают глюкозу натощак.
 */
export function nightGlucose(
  points: readonly { m: number; glucose: number | null }[],
  segments: readonly { from: number; to: number }[],
  steps: readonly { m: number; v: number }[],
): number[] {
  const asleep = (m: number) => segments.some((s) => m >= Math.max(0, s.from) && m <= s.to);
  const quiet = (m: number) =>
    !steps.some((s) => s.v >= STEP_MIN_PER_MIN && Math.abs(s.m - m) <= FOOD_QUIET_WINDOW_MIN);
  return points
    .filter((p) => p.glucose !== null && asleep(p.m) && quiet(p.m))
    .map((p) => p.glucose as number);
}

/**
 * Точка отсчёта голодания: минута с самой низкой глюкозой в последние четыре часа перед сном.
 * Замеров в этом окне нет — считаем от засыпания. Минуты — на оси дня пробуждения,
 * вечер накануне отрицательный.
 */
export function fastingStart(
  points: readonly { m: number; glucose: number | null }[],
  sleepOnset: number,
): number {
  const from = sleepOnset - FASTING_LOOKBACK_HOURS * 60;
  const inWindow = points.filter((p) => p.glucose !== null && p.m >= from && p.m <= sleepOnset);
  if (!inWindow.length) return sleepOnset;
  return inWindow.reduce((best, p) => ((p.glucose as number) < (best.glucose as number) ? p : best)).m;
}

/** Режим дня. Порядок проверок задан владельцем: гипергликемия → восстановление → базовый. */
export function foodMode(input: { sleepScore: number; glucose: number | null; baseline: number | null }): FoodMode {
  const share =
    input.glucose === null || input.baseline === null || input.baseline === 0
      ? null
      : (input.glucose - input.baseline) / input.baseline;
  const high = share !== null && share > FOOD_NORM_HIGH_SHARE;
  const low = share !== null && share < FOOD_NORM_LOW_SHARE;
  if (high && input.sleepScore > FOOD_SLEEP_OK) return 'hyper';
  if (input.sleepScore <= FOOD_SLEEP_OK || low) return 'recovery';
  return 'base';
}

export interface FoodMeal {
  title: string;
  /** Минуты от полуночи сегодняшнего дня. */
  minute: number;
}

const mid = (range: readonly [number, number]) => (range[0] + range[1]) / 2;
const hoursAfter = (minute: number, hours: number) => Math.round(minute + hours * 60);

/** Расписание приёмов пищи от пробуждения. */
export function foodMeals(mode: FoodMode, wakeMinute: number): FoodMeal[] {
  if (mode === 'recovery') {
    const r = FOOD_SCHEDULE.recovery;
    return [
      { title: 'Завтрак', minute: hoursAfter(wakeMinute, mid(r.first)) },
      { title: 'Обед', minute: hoursAfter(wakeMinute, mid(r.lunch)) },
      { title: 'Ужин', minute: hoursAfter(wakeMinute, mid(r.dinner)) },
    ];
  }
  if (mode === 'hyper') {
    return [
      { title: 'Первый приём', minute: hoursAfter(wakeMinute, FOOD_SCHEDULE.hyper.first) },
      { title: 'Второй приём', minute: hoursAfter(wakeMinute, FOOD_SCHEDULE.hyper.second) },
    ];
  }
  const first = hoursAfter(wakeMinute, FOOD_SCHEDULE.base.first);
  return [
    { title: 'Первый приём', minute: first },
    { title: 'Второй приём', minute: hoursAfter(first, FOOD_SCHEDULE.base.gapAfterFirst) },
  ];
}

/**
 * Часы аутофагии: от точки отсчёта голодания до «сейчас» (или до первого приёма, если он уже был)
 * минус двенадцать часов. Меньше нуля — ноль.
 */
export function autophagyMinutes(input: { fastingStart: number; firstMeal: number; nowMinute: number }): number {
  const until = input.nowMinute < input.firstMeal ? input.nowMinute : input.firstMeal;
  return Math.max(0, until - input.fastingStart - AUTOPHAGY_AFTER_HOURS * 60);
}

const HOUR_FORMS = ['час', 'часа', 'часов'] as const;
const MINUTE_FORMS = ['минута', 'минуты', 'минут'] as const;

/** Мелкая подпись под крупным числом часов. */
export const AUTOPHAGY_CAPTION = 'аутофагии за ночь';

/** Крупное значение счётчика: «3 часа 40 минут», «41 минута», «0 часов». */
export function autophagyValue(minutes: number): string {
  if (minutes <= 0) return `0 ${pluralRu(0, HOUR_FORMS)}`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [
    h > 0 ? `${h} ${pluralRu(h, HOUR_FORMS)}` : null,
    m > 0 ? `${m} ${pluralRu(m, MINUTE_FORMS)}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface FoodInput {
  /** Подъём сегодняшней ночи, минуты от полуночи. */
  wakeMinute: number;
  /** Засыпание сегодняшней ночи: вечер накануне — отрицательные минуты. */
  sleepOnset: number;
  /** Индекс «Сон» за сегодня. */
  sleepScore: number;
  /** Медиана сегодняшней ночной глюкозы; null — замеров не было. */
  glucose: number | null;
  /** Личная норма «натощак» — медиана ночной глюкозы за семь дней; null — данных мало. */
  baseline: number | null;
  /** Точка отсчёта голодания на оси сегодняшнего дня. */
  fastingStart: number;
  nowMinute: number;
}

export interface FoodCycle {
  mode: FoodMode;
  title: string;
  meals: FoodMeal[];
  /** Отрезок голодания для таймлайна. */
  fastingStart: number;
  firstMeal: number;
  glucose: number | null;
  baseline: number | null;
  autophagy: number;
  /** «3 часа 40 минут» — крупной строкой; подпись под ней — AUTOPHAGY_CAPTION. */
  autophagyValue: string;
  nowMinute: number;
}

/** Карточка «Цикл питания» целиком. */
export function foodCycle(input: FoodInput): FoodCycle {
  const mode = foodMode({ sleepScore: input.sleepScore, glucose: input.glucose, baseline: input.baseline });
  const meals = foodMeals(mode, input.wakeMinute);
  const firstMeal = meals[0].minute;
  const autophagy = autophagyMinutes({ fastingStart: input.fastingStart, firstMeal, nowMinute: input.nowMinute });
  return {
    mode,
    title: FOOD_MODE[mode].title,
    meals,
    fastingStart: input.fastingStart,
    firstMeal,
    glucose: input.glucose,
    baseline: input.baseline,
    autophagy,
    autophagyValue: autophagyValue(autophagy),
    nowMinute: input.nowMinute,
  };
}
