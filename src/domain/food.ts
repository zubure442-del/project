/**
 * «Цикл питания»: когда сегодня удобнее есть и сколько времени организм провёл без еды.
 *
 * Ночная глюкоза (замеры внутри сна, когда не было активности) за последние семь дней даёт
 * личную норму «натощак» — медиану, она устойчивее среднего к одиночным выбросам. Сегодняшняя
 * ночная глюкоза сравнивается с этой нормой, а вместе с индексом «Сон» выбирает режим дня.
 * Расписание строится от времени пробуждения, а справа от него стоит колба (flask.ts).
 * Не медицинская рекомендация и не диагноз.
 */
import type { FlaskView } from './flask';
import { STEP_MIN_PER_MIN } from './score';
import { NOT_MEDICAL_DEVICE } from './texts';

/** Окно личной нормы «глюкозы натощак»: последние семь дней. */
export const FOOD_BASELINE_DAYS = 7;
/** Меньше стольких ночных замеров за окно — нормы нет, с чем сравнивать неизвестно. */
export const FOOD_BASELINE_MIN_READINGS = 3;
/** Коридор нормы: от −10 % до +25 % личной нормы. */
export const FOOD_NORM_LOW_SHARE = -0.1;
export const FOOD_NORM_HIGH_SHARE = 0.25;
/** Выше этого индекса «Сон» ночь считается восстановившей. */
export const FOOD_SLEEP_OK = 70;
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

/** Фиксированный текст кнопки «i» на карточке. Про пользу и про колбу, без формул и чисел. */
export const AUTOPHAGY_INFO = {
  title: 'Что показывает колба',
  text:
    'Колба — это путь, который организм проходит между приёмами пищи. Сначала «Переработка»: ' +
    'он разбирается с тем, что вы съели. Потом «Жиросжигание»: энергия берётся из запасов. ' +
    'И наверху «Аутофагия» — естественная уборка внутри клеток, когда организм разбирает ' +
    'и пускает в дело накопившийся внутренний мусор.\n\n' +
    'Вода поднимается тем быстрее, чем спокойнее держится ваш сахар и чем больше вы двигались. ' +
    'В меру такая пауза полезна — и «Цикл питания» помогает держать эту меру: когда организм ' +
    'восстановился, мы оставляем паузу длиннее, а когда нет — предлагаем есть чаще, потому что ' +
    'в такие дни ему нужнее силы.\n\n' +
    'Доверху колба не наполняется никогда: это не соревнование и не задача на день. ' + NOT_MEDICAL_DEVICE,
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
  /** Минуты от полуночи сегодняшнего дня: время на карточке. */
  minute: number;
  /** Начало и конец приёма: по ним «Пик выносливости» обходит еду. */
  from: number;
  to: number;
}

/**
 * Сколько длится приём, если в расписании одно время (владелец: 30–60 минут), — берём час,
 * время на карточке — его середина. В «Режиме восстановления» начало и конец заданы диапазоном.
 */
export const FOOD_MEAL_DURATION_MIN = 60;

const mid = (range: readonly [number, number]) => (range[0] + range[1]) / 2;
const hoursAfter = (minute: number, hours: number) => Math.round(minute + hours * 60);
/** Приём с одним временем: час с серединой в этой минуте. */
const single = (title: string, minute: number): FoodMeal => ({
  title,
  minute,
  from: minute - FOOD_MEAL_DURATION_MIN / 2,
  to: minute + FOOD_MEAL_DURATION_MIN / 2,
});
/** Приём с диапазоном «через N–M часов после подъёма». */
const ranged = (title: string, wakeMinute: number, range: readonly [number, number]): FoodMeal => ({
  title,
  minute: hoursAfter(wakeMinute, mid(range)),
  from: hoursAfter(wakeMinute, range[0]),
  to: hoursAfter(wakeMinute, range[1]),
});

/** Расписание приёмов пищи от пробуждения. */
export function foodMeals(mode: FoodMode, wakeMinute: number): FoodMeal[] {
  if (mode === 'recovery') {
    const r = FOOD_SCHEDULE.recovery;
    return [
      ranged('Завтрак', wakeMinute, r.first),
      ranged('Обед', wakeMinute, r.lunch),
      ranged('Ужин', wakeMinute, r.dinner),
    ];
  }
  if (mode === 'hyper') {
    return [
      single('Первый приём', hoursAfter(wakeMinute, FOOD_SCHEDULE.hyper.first)),
      single('Второй приём', hoursAfter(wakeMinute, FOOD_SCHEDULE.hyper.second)),
    ];
  }
  const first = hoursAfter(wakeMinute, FOOD_SCHEDULE.base.first);
  return [single('Первый приём', first), single('Второй приём', hoursAfter(first, FOOD_SCHEDULE.base.gapAfterFirst))];
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
  /** Колба: уровень и слой по глюкозе за сутки; null — замеров нет. */
  flask: FlaskView | null;
  nowMinute: number;
}

export interface FoodCycle {
  mode: FoodMode;
  title: string;
  meals: FoodMeal[];
  glucose: number | null;
  baseline: number | null;
  /** Колба справа от списка приёмов пищи; null — замеров глюкозы нет. */
  flask: FlaskView | null;
  nowMinute: number;
}

/** Карточка «Цикл питания» целиком. */
export function foodCycle(input: FoodInput): FoodCycle {
  const mode = foodMode({ sleepScore: input.sleepScore, glucose: input.glucose, baseline: input.baseline });
  return {
    mode,
    title: FOOD_MODE[mode].title,
    meals: foodMeals(mode, input.wakeMinute),
    glucose: input.glucose,
    baseline: input.baseline,
    flask: input.flask,
    nowMinute: input.nowMinute,
  };
}
