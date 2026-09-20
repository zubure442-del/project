import { wallClock, type Sample } from '../codec';
import { DEEP_MIN_STATE } from './sleep';

/** Подготовка данных для графиков. Только чистые функции: ни расчётов, ни побочных эффектов. */

export type SleepStage = 'awake' | 'light' | 'deep';

export interface HypnogramSegment {
  /** Кольцевые метки времени: начало и конец отрезка одной фазы. */
  from: number;
  to: number;
  stage: SleepStage;
}

export function sleepStage(value: number): SleepStage {
  if (value >= DEEP_MIN_STATE) return 'deep';
  return value >= 1 ? 'light' : 'awake';
}

/**
 * Минутные состояния сна → отрезки для гипнограммы: соседние минуты одной фазы сливаются.
 * Пропуск длиннее maxGap разрывает отрезок — «дорисовывать» сон за время без данных нельзя.
 */
export function hypnogramSegments(samples: Sample[], maxGapSec = 300): HypnogramSegment[] {
  const items = [...samples].sort((a, b) => a.ts - b.ts);
  const out: HypnogramSegment[] = [];
  for (const { ts, value } of items) {
    const stage = sleepStage(value);
    const last = out[out.length - 1];
    if (last && last.stage === stage && ts - last.to <= maxGapSec) last.to = ts + 60;
    else out.push({ from: ts, to: ts + 60, stage });
  }
  return out;
}

/** Шаги по часам суток: 24 числа. Минуты без данных считаются нулём шагов. */
export function stepsByHour(samples: Sample[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const s of samples) hours[wallClock(s.ts).hour] += s.value;
  return hours;
}

/**
 * Круглые значения для вертикальной оси: примерно count штук в диапазоне.
 * Шаг выбирается из 1, 2, 2.5, 5, 10 — чтобы подписи читались.
 */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (!(max > min) || count < 2) return [min];
  const rough = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1000; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks.length ? ticks : [min, max];
}

/** «7:05» из минут от полуночи; отрицательные минуты — это предыдущий вечер, 1440 — конец суток. */
export function formatMinute(minuteOfDay: number): string {
  const rounded = Math.round(minuteOfDay);
  if (rounded === 1440) return '24:00';
  const m = ((rounded % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
