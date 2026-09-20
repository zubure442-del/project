import type { Sample } from '../codec/types';
import { smoothHeart } from './heart';
import type { SleepSession } from './sleep';
import { sleepMinutes } from './sleep';

/** Веса итога (решение владельца). Считаются только по тем составляющим, где есть данные. */
export const WEIGHTS = { sleep: 15, activity: 70, state: 15 } as const;
export type ComponentId = keyof typeof WEIGHTS;

/** Один замер в зоне даёт баллы за 30 минут (период автозамера в main.py); короче интервал — пропорционально меньше. */
const CARDIO_REFERENCE_MIN = 30;

export interface ScoreInput {
  /** Ночь дня; null — сна нет в данных. */
  night: SleepSession | null;
  /** Шаги за день; null — не было выгрузки. 0 — настоящий ноль. */
  steps: number | null;
  /** Очищенный пульс за день. */
  heart: Sample[];
  /** Возраст для максимального пульса; null — неизвестен (кардио-бонус не начисляется). */
  age: number | null;
  hrv: number[];
}

export interface ComponentScore {
  /** 0–100 или null («недостаточно данных»). */
  score: number | null;
  /** Вес после пересчёта, доли единицы; 0, если данных нет. */
  weight: number;
}

export interface RestingHr {
  value: number;
  /** night — пульс покоя за ночь; day — запасной расчёт: минимум за день. */
  source: 'night' | 'day';
}

export interface DayScore {
  total: number | null;
  sleep: ComponentScore;
  activity: ComponentScore;
  state: ComponentScore;
  restingHr: RestingHr | null;
  /** Какие входы «организма» удалось посчитать — для объяснения в интерфейсе. */
  stateInputs: { hrv: boolean; restingHr: boolean };
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

export function sleepScore(night: SleepSession | null): number | null {
  if (!night) return null;
  const total = sleepMinutes(night);
  const volume = Math.min(100, (total / 420) * 100);
  const deepRatio = night.deepMin / total;
  const quality = deepRatio >= 0.15 && deepRatio <= 0.25 ? 100 : Math.max(0, 100 - Math.abs(0.2 - deepRatio) * 400);
  return volume * 0.7 + quality * 0.3;
}

export function cardioPoints(heart: Sample[], age: number | null): number | null {
  if (age === null || !heart.length) return null;
  const maxHr = 208 - 0.7 * age;
  const items = [...heart].sort((a, b) => a.ts - b.ts);
  let points = 0;
  items.forEach((s, i) => {
    const next = items[i + 1];
    const minutes = next ? Math.min((next.ts - s.ts) / 60, CARDIO_REFERENCE_MIN) : CARDIO_REFERENCE_MIN;
    const pct = s.value / maxHr;
    const zone = pct > 0.85 ? 2 : pct > 0.7 ? 1 : pct > 0.6 ? 0.5 : 0;
    points += zone * (minutes / CARDIO_REFERENCE_MIN);
  });
  return points;
}

/** Активность: шаги ведут итог (растёт в течение дня); интенсивный пульс — бонус. Нет шагов — нет оценки. */
export function activityScore(steps: number | null, heart: Sample[], age: number | null): number | null {
  if (steps === null) return null;
  const stepScore = Math.min(100, (steps / 10000) * 100);
  const bonus = cardioPoints(heart, age) ?? 0;
  return Math.min(100, stepScore * 0.7 + bonus * 4);
}

const medianOfLowest = (values: number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted.slice(0, Math.max(1, Math.round(sorted.length * share)));
  const mid = low.length >> 1;
  return Math.round(low.length % 2 ? low[mid] : (low[mid - 1] + low[mid]) / 2);
};

const MIN_NIGHT_SAMPLES = 3;
const MIN_DAY_SAMPLES = 5;

/**
 * Пульс покоя: медиана самых низких 25 % замеров за ночь.
 * Если ночи нет, запасной вариант — медиана нижних 10 % сглаженных замеров за день;
 * это уже не пульс покоя, а минимум за день, поэтому источник возвращается отдельно.
 */
export function restingHeartRate(heart: Sample[], night: SleepSession | null): RestingHr | null {
  if (night) {
    const atNight = heart.filter((s) => s.ts >= night.start && s.ts <= night.end).map((s) => s.value);
    if (atNight.length >= MIN_NIGHT_SAMPLES) return { value: medianOfLowest(atNight, 0.25), source: 'night' };
  }
  if (heart.length < MIN_DAY_SAMPLES) return null;
  return { value: medianOfLowest(smoothHeart(heart).map((s) => s.value), 0.1), source: 'day' };
}

/**
 * «Организм» — среднее двух оценок: вариабельность ритма и пульс во сне.
 * Нужны обе: по одному входу оценка получалась бы на пустом месте.
 */
export function stateScore(hrv: number[], restingHr: RestingHr | null): number | null {
  if (!hrv.length || restingHr?.source !== 'night') return null;
  const hrvScore = Math.min(100, (avg(hrv) / 65) * 100);
  const pulseScore = clamp(100 - Math.max(0, restingHr.value - 60) * 2.5);
  return (hrvScore + pulseScore) / 2;
}

export function computeDayScore(input: ScoreInput): DayScore {
  const restingHr = restingHeartRate(input.heart, input.night);
  const scores: Record<ComponentId, number | null> = {
    sleep: sleepScore(input.night),
    activity: activityScore(input.steps, input.heart, input.age),
    state: stateScore(input.hrv, restingHr),
  };
  const present = (Object.keys(WEIGHTS) as ComponentId[]).filter((k) => scores[k] !== null);
  const weightSum = present.reduce((sum, k) => sum + WEIGHTS[k], 0);
  const comp = (k: ComponentId): ComponentScore => ({
    score: scores[k] === null ? null : Math.round(scores[k]),
    weight: scores[k] === null ? 0 : WEIGHTS[k] / weightSum,
  });
  const total = weightSum === 0 ? null : Math.round(present.reduce((sum, k) => sum + WEIGHTS[k] * (scores[k] as number), 0) / weightSum);
  return {
    total,
    sleep: comp('sleep'),
    activity: comp('activity'),
    state: comp('state'),
    restingHr,
    stateInputs: { hrv: input.hrv.length > 0, restingHr: restingHr?.source === 'night' },
  };
}
