/**
 * «Кофейное окно»: когда кофе меньше мешает сну. Не медицинская рекомендация:
 * окно открывается через полтора часа после подъёма и закрывается за восемь часов
 * до вашего обычного отхода ко сну.
 */

/** Отход ко сну по умолчанию, если истории нет: 22:00. */
export const DEFAULT_BEDTIME_MIN = 22 * 60;
/** По скольким последним ночам с данными считаем обычное время отхода ко сну. */
export const BEDTIME_HISTORY_DAYS = 7;
export const COFFEE_START_DELAY_MIN = 90;
export const COFFEE_CUTOFF_BUFFER_HOURS = 8;
/** Короткий или неглубокий сон: оценка ниже этого или длительность меньше этого. */
export const SLEEP_POOR_THRESHOLD = 50;
export const SLEEP_POOR_DURATION_H = 5.5;
/** До этого часа — ночь: окна нет. */
export const COFFEE_NIGHT_UNTIL_MIN = 5 * 60;

export const COFFEE_TEXT = {
  noSleep: 'Кольцо ещё не записало сон',
  poorSleep: 'Сон был коротким — сегодня, возможно, стоит сократить кофе.',
  noWindow: 'Сегодня лучше без кофе',
  closed: 'Сейчас не время для кофе. Следующее окно — после следующего пробуждения.',
} as const;

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

export type CoffeeWindow =
  | { kind: 'no-sleep'; text: string }
  | { kind: 'poor-sleep'; text: string }
  | { kind: 'no-window'; text: string; start: number; cutoff: number }
  | { kind: 'window'; text: string; start: number; cutoff: number; phase: 'before' | 'open' | 'after' };

export interface CoffeeInput {
  /** Подъём по последней ночи с данными (сегодняшней или последней доступной); null — сна нет вовсе. */
  wakeMinute: number | null;
  sleepScore: number | null;
  sleepMinutes: number | null;
  /** Отход ко сну за прошлые ночи, в минутах от полуночи дня пробуждения + 1440. */
  bedtimes: readonly number[];
  nowMinute: number;
}

export function coffeeWindow(input: CoffeeInput): CoffeeWindow {
  if (input.wakeMinute === null) return { kind: 'no-sleep', text: COFFEE_TEXT.noSleep };
  const poor =
    (input.sleepScore !== null && input.sleepScore < SLEEP_POOR_THRESHOLD) ||
    (input.sleepMinutes !== null && input.sleepMinutes < SLEEP_POOR_DURATION_H * 60);
  if (poor) return { kind: 'poor-sleep', text: COFFEE_TEXT.poorSleep };

  const start = input.wakeMinute + COFFEE_START_DELAY_MIN;
  const cutoff = averageBedtime(input.bedtimes) - COFFEE_CUTOFF_BUFFER_HOURS * 60;
  if (start >= cutoff) return { kind: 'no-window', text: COFFEE_TEXT.noWindow, start, cutoff };

  const now = input.nowMinute;
  if (now < COFFEE_NIGHT_UNTIL_MIN || now >= cutoff) return { kind: 'window', text: COFFEE_TEXT.closed, start, cutoff, phase: 'after' };
  if (now < start) return { kind: 'window', text: `Окно откроется в ${hhmm(start)}`, start, cutoff, phase: 'before' };
  return { kind: 'window', text: `Окно открыто до ${hhmm(cutoff)}`, start, cutoff, phase: 'open' };
}

export const coffeeClock = hhmm;
