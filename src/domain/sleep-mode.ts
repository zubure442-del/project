import { NOT_MEDICAL_DEVICE } from './texts';

/**
 * «Режим сна» — во сколько лечь сегодня, чтобы выспаться к обычному подъёму.
 *
 * Идея из двух подходов:
 * - потребность во сне считается как у Whoop: своя база + долг последних ночей + добавка за активный день;
 * - время отхода — как у Oura: от ОБЫЧНОГО времени подъёма (постоянный подъём — главная опора режима)
 *   и своей длительности сна по лучшим ночам.
 * Медицинские рамки: взрослым нужно 7–9 часов сна; долг не возвращается за одну ночь — добавляем не больше
 * часа; ложиться резко раньше привычного бесполезно — за час-два до обычного сна организм бодрее всего
 * («зона бодрствования»), поэтому раньше привычного больше чем на час не сдвигаем; за час до сна —
 * меньше яркого света и экранов.
 * Все времена — минуты от полуночи даты начала текущего цикла (после полуночи — больше 1440).
 */

/** Рамки потребности во сне: 7–9 часов (рекомендация для взрослых). */
export const SLEEP_NEED_MIN_MIN = 7 * 60;
export const SLEEP_NEED_MAX_MIN = 9 * 60;
/** Своей базы ещё нет — 7.5 часа (у Whoop средняя база 7.6 ч). */
export const SLEEP_NEED_DEFAULT_MIN = 450;
/** Своя база — по лучшей трети ночей по оценке сна (как «лучшие ночи» у Oura); ночей нужно не меньше этого. */
export const SLEEP_BASE_MIN_NIGHTS = 3;
/** Долг сна — за столько последних ночей; за одну ночь возвращаем не больше часа. */
export const SLEEP_DEBT_NIGHTS = 3;
export const SLEEP_DEBT_MAX_EXTRA_MIN = 60;
/** Добавка за активный день: до 40 минут при максимальной активности (у Whoop высокая нагрузка — около 37 минут). */
export const SLEEP_ACTIVITY_EXTRA_MAX_MIN = 40;
/** Доля сна от времени в постели, если своей ещё нет (норма — от 85 %), и её рамки. */
export const SLEEP_EFFICIENCY_DEFAULT = 0.9;
export const SLEEP_EFFICIENCY_RANGE = { min: 0.7, max: 1 } as const;
/** Сколько обычно уходит на засыпание. */
export const SLEEP_LATENCY_MIN = 15;
/** Раньше привычного времени отхода больше чем на столько не сдвигаем (зона бодрствования перед сном). */
export const BEDTIME_MAX_SHIFT_EARLIER_MIN = 60;
/** Окно отхода ко сну: плюс-минус столько (как окно у Oura). */
export const BEDTIME_WINDOW_HALF_MIN = 15;
/** За столько до окна на карточке — «Скоро время ложиться». */
export const WIND_DOWN_MIN = 60;
/**
 * Сколько долга возвращается за ночь по графику: столько, сколько план на сегодня даёт сверх
 * своей базы, но не меньше 30 и не больше 60 минут. Не меньше 30 — потому что привычный отход
 * считается по последним ночам: если ложиться по графику, он сдвигается раньше, и возвращать
 * становится легче.
 */
export const SLEEP_REPAY_MIN_MIN = 30;

/** Одна прошлая ночь (главный сон дня). */
export interface SleepNight {
  /** Сколько спал, минуты (глубокий + лёгкий). */
  sleptMin: number;
  /** Сколько длилась сессия от первой до последней минуты сна, минуты. */
  spanMin: number;
  /** Оценка сна этой ночи; null — не посчитана. */
  score: number | null;
  /** Подъём, минуты от полуночи дня пробуждения. */
  wakeMinute: number;
}

export interface SleepModeInput {
  /** Прошлые ночи за две недели, последняя — сегодняшняя (сон текущего цикла). */
  nights: readonly SleepNight[];
  /** Обычный отход ко сну (как у «Кофейного окна»), минуты от полуночи даты цикла. */
  usualBedtime: number;
  /** Индекс активности текущего цикла, 0–100; null — нет. */
  activity: number | null;
  /** «Сейчас», минуты от полуночи даты цикла. */
  nowMinute: number;
}

export type SleepModePhase = 'day' | 'windDown' | 'bedtime' | 'late';

export interface SleepMode {
  /** Окно отхода ко сну. */
  from: number;
  to: number;
  /** Подъём завтра — обычное время. */
  wake: number;
  /** С этого момента — «Скоро время ложиться». */
  windDown: number;
  /** Сколько сна нужно сегодня. */
  needMin: number;
  /** Долг сна за последние ночи (весь, а не только сегодняшняя добавка). */
  debtMin: number;
  /** За сколько ночей по графику вернётся долг; 0 — долга нет. */
  repayNights: number;
  phase: SleepModePhase;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const round5 = (m: number) => Math.round(m / 5) * 5;

/** Своя база: средняя длительность лучшей трети ночей по оценке сна, в рамках 7–9 часов. */
export function baseSleepNeed(nights: readonly SleepNight[]): number {
  const scored = nights.filter((n) => n.score !== null && n.sleptMin > 0);
  if (scored.length < SLEEP_BASE_MIN_NIGHTS) return SLEEP_NEED_DEFAULT_MIN;
  const best = [...scored].sort((a, b) => (b.score as number) - (a.score as number)).slice(0, Math.ceil(scored.length / 3));
  return clamp(Math.round(mean(best.map((n) => n.sleptMin))), SLEEP_NEED_MIN_MIN, SLEEP_NEED_MAX_MIN);
}

/** Долг: сколько недоспано за последние ночи против своей базы. */
export function sleepDebt(nights: readonly SleepNight[], base: number): number {
  return nights.slice(-SLEEP_DEBT_NIGHTS).reduce((sum, n) => sum + Math.max(0, base - n.sleptMin), 0);
}

/** Доля сна от времени в постели по своим ночам. */
export function sleepEfficiency(nights: readonly SleepNight[]): number {
  const known = nights.filter((n) => n.spanMin > 0).map((n) => n.sleptMin / n.spanMin);
  if (!known.length) return SLEEP_EFFICIENCY_DEFAULT;
  return clamp(mean(known), SLEEP_EFFICIENCY_RANGE.min, SLEEP_EFFICIENCY_RANGE.max);
}

export function sleepMode(input: SleepModeInput): SleepMode {
  const { nights } = input;
  const base = baseSleepNeed(nights);
  const debtMin = sleepDebt(nights, base);
  const activityExtra = input.activity === null ? 0 : (clamp(input.activity, 0, 100) / 100) * SLEEP_ACTIVITY_EXTRA_MAX_MIN;
  const needMin = round5(base + Math.min(debtMin, SLEEP_DEBT_MAX_EXTRA_MIN) + activityExtra);

  // Подъём завтра — обычный: среднее по последним ночам (сегодняшняя входит).
  const wakes = nights.slice(-7).map((n) => n.wakeMinute);
  const wake = 1440 + round5(wakes.length ? mean(wakes) : 7 * 60);
  const inBed = needMin / sleepEfficiency(nights) + SLEEP_LATENCY_MIN;
  const ideal = wake - inBed;
  const earliest = input.usualBedtime - BEDTIME_MAX_SHIFT_EARLIER_MIN;
  const bedtime = round5(Math.max(ideal, earliest));
  // Сколько сна даёт план сверх базы — столько долга и возвращается за ночь.
  const planned = (wake - bedtime - SLEEP_LATENCY_MIN) * sleepEfficiency(nights);
  const repayPerNight = clamp(planned - base - activityExtra, SLEEP_REPAY_MIN_MIN, SLEEP_DEBT_MAX_EXTRA_MIN);
  const repayNights = debtMin > 0 ? Math.ceil(debtMin / repayPerNight) : 0;
  const from = bedtime - BEDTIME_WINDOW_HALF_MIN;
  const to = bedtime + BEDTIME_WINDOW_HALF_MIN;
  const windDown = from - WIND_DOWN_MIN;

  const now = input.nowMinute;
  const phase: SleepModePhase = now < windDown ? 'day' : now < from ? 'windDown' : now <= to ? 'bedtime' : 'late';
  return { from, to, wake, windDown, needMin, debtMin: Math.round(debtMin), repayNights, phase };
}

/** Строка состояния на карточке. */
export const SLEEP_MODE_PHASE_TEXT: Record<SleepModePhase, string> = {
  day: 'План на вечер',
  windDown: 'Скоро время ложиться',
  bedtime: 'Лучшее время лечь',
  late: 'Окно прошло — ложитесь, как только сможете',
};

/** «i» в шапке карточки: общими словами, без того, как считается (владелец: расчёты — наш секрет). */
export const SLEEP_MODE_INFO = {
  title: 'Режим сна',
  text:
    'Режим сна — ваше время отхода ко сну на сегодня. Мы подбираем его каждый день по вашим данным, ' +
    'чтобы вы высыпались и вставали в своё время, а накопившийся недосып уходил без рывков.\n\n' +
    NOT_MEDICAL_DEVICE,
} as const;
