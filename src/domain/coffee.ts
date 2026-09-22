/**
 * «Кофейное окно»: когда кофе меньше мешает сну. Не медицинская рекомендация:
 * окно открывается через полтора часа после подъёма и закрывается за восемь часов
 * до вашего обычного отхода ко сну. Показывается только за сегодня и только когда
 * оценка сна за сегодня посчитана — при любом её значении.
 */

/** Отход ко сну по умолчанию, если истории нет: 22:00. */
export const DEFAULT_BEDTIME_MIN = 22 * 60;
/** По скольким последним ночам с данными считаем обычное время отхода ко сну. */
export const BEDTIME_HISTORY_DAYS = 7;
export const COFFEE_START_DELAY_MIN = 90;
export const COFFEE_CUTOFF_BUFFER_HOURS = 8;
/** До этого часа — ночь: окна нет. */
export const COFFEE_NIGHT_UNTIL_MIN = 5 * 60;
/**
 * Совет по числу чашек показываем только в разумное время: с 6:00 до 18:00 (минуты от полуночи).
 * Вне окна — только таймлайн, без совета и без текста вместо него.
 */
export const COFFEE_ADVICE_FROM_MIN = 6 * 60;
export const COFFEE_ADVICE_UNTIL_MIN = 18 * 60;

/** Виден ли совет по чашкам в эту минуту суток: [6:00, 18:00). */
export const coffeeAdviceVisible = (nowMinute: number): boolean =>
  nowMinute >= COFFEE_ADVICE_FROM_MIN && nowMinute < COFFEE_ADVICE_UNTIL_MIN;

/** Число чашек по оценке сна: ниже первого порога — 1, ниже второго — 2, дальше — 3. */
export const COFFEE_CUPS_TWO_FROM = 60;
export const COFFEE_CUPS_THREE_FROM = 90;

export const COFFEE_TEXT = {
  noWindow: 'Сегодня лучше без кофе',
  closed: 'Сейчас не время для кофе. Следующее окно — после следующего пробуждения.',
} as const;

export type CoffeeCups = 1 | 2 | 3;

/** Текст под таймлайном: сколько чашек, по оценке сна за сегодня. */
export const COFFEE_CUPS_TEXT: Record<CoffeeCups, string> = {
  1: 'На основе вашего сна рекомендуем не более 1 чашки сегодня, чтобы восстановить силы и не нарушить засыпание вечером.',
  2: 'На основе вашего сна рекомендуем не более 2 чашек сегодня, чтобы восстановить силы и не нарушить засыпание вечером.',
  3: 'На основе вашего сна рекомендуем не более 3 чашек сегодня, чтобы восстановить силы и не нарушить засыпание вечером.',
};

/** Сон < 60 → 1 чашка, 60–89 → 2, 90–100 → 3. */
export const coffeeCups = (sleepScore: number): CoffeeCups =>
  sleepScore < COFFEE_CUPS_TWO_FROM ? 1 : sleepScore < COFFEE_CUPS_THREE_FROM ? 2 : 3;

const hhmm = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Обычное время отхода ко сну — среднее за последние ночи. Время — в минутах от полуночи
 * сегодняшнего дня: 23:00 — 1380, половина первого ночи — 1470. Нет истории — 22:00.
 */
export function averageBedtime(bedtimes: readonly number[]): number {
  const recent = bedtimes.slice(-BEDTIME_HISTORY_DAYS);
  return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : DEFAULT_BEDTIME_MIN;
}

/**
 * Карточка «Кофейного окна»: статус над таймлайном и совет по числу чашек под ним.
 * Старт позже отсечки — «Сегодня лучше без кофе», таймлайн целиком красный и совета по чашкам нет.
 * Совет по чашкам — только с 6:00 до 18:00 (`coffeeAdviceVisible`), иначе `cups: null`.
 */
export type CoffeeWindow =
  | { kind: 'no-window'; text: string; start: number; cutoff: number; cups: null }
  | {
      kind: 'window';
      text: string;
      start: number;
      cutoff: number;
      phase: 'before' | 'open' | 'after';
      /** null — вне окна показа совета (6:00–18:00): только таймлайн. */
      cups: { n: CoffeeCups; text: string } | null;
    };

export interface CoffeeInput {
  /** Подъём по сегодняшней ночи, минуты от полуночи. */
  wakeMinute: number;
  /** Оценка сна за сегодня (0–100). */
  sleepScore: number;
  /** Отход ко сну за прошлые ночи, в минутах от полуночи дня пробуждения + 1440. */
  bedtimes: readonly number[];
  nowMinute: number;
}

export function coffeeWindow(input: CoffeeInput): CoffeeWindow {
  const start = input.wakeMinute + COFFEE_START_DELAY_MIN;
  const cutoff = averageBedtime(input.bedtimes) - COFFEE_CUTOFF_BUFFER_HOURS * 60;
  if (start >= cutoff) return { kind: 'no-window', text: COFFEE_TEXT.noWindow, start, cutoff, cups: null };

  const n = coffeeCups(input.sleepScore);
  const now = input.nowMinute;
  const cups = coffeeAdviceVisible(now) ? { n, text: COFFEE_CUPS_TEXT[n] } : null;
  const base = { kind: 'window' as const, start, cutoff, cups };
  if (now < COFFEE_NIGHT_UNTIL_MIN || now >= cutoff) return { ...base, text: COFFEE_TEXT.closed, phase: 'after' };
  if (now < start) return { ...base, text: `Окно откроется в ${hhmm(start)}`, phase: 'before' };
  return { ...base, text: `Окно открыто до ${hhmm(cutoff)}`, phase: 'open' };
}

export const coffeeClock = hhmm;
