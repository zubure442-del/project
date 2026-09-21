import { STEPS_DEFAULT_NORM } from './steps-norm';
import type { Sample } from '../codec/types';
import { smoothHeart } from './heart';
import type { SleepSession } from './sleep';
import { sleepMinutes } from './sleep';

/** Веса итога (решение владельца). Считаются только по тем составляющим, где есть данные. */
export const WEIGHTS = { sleep: 15, activity: 70, state: 15 } as const;
export type ComponentId = keyof typeof WEIGHTS;

/** Один замер в зоне даёт баллы за 30 минут (период автозамера); короче интервал — пропорционально меньше. */
export const CARDIO_REFERENCE_MIN = 30;
export const STEPS_WEIGHT = 0.7;
export const CARDIO_WEIGHT = 4;
export const SLEEP_TARGET_MIN = 420;
export const SLEEP_VOLUME_WEIGHT = 0.7;
export const DEEP_RATIO_BEST = { from: 0.15, to: 0.25 } as const;
export const HRV_TARGET = 65;
export const RESTING_HR_TARGET = 60;
export const RESTING_HR_PENALTY = 2.5;
/** Пульсовые зоны, которые учитывает оценка активности: доля от максимального пульса и очки. */
export const CARDIO_ZONES = [
  { from: 0.85, points: 2 },
  { from: 0.7, points: 1 },
  { from: 0.6, points: 0.5 },
] as const;
/** Нижняя граница зон, которые учитывает оценка активности. */
export const ACTIVE_HR_RATIO = CARDIO_ZONES[CARDIO_ZONES.length - 1].from;
/** Порог «активного» пульса для графика: половина максимального. */
export const ACTIVE_HR_LOW_RATIO = 0.5;
/** Насколько пульс должен подняться над пульсом покоя, чтобы считаться нагрузкой. */
export const ACTIVE_HR_OVER_RESTING = 25;
/** Шагов в минуту, начиная с которых минута считается активной. */
export const STEP_MIN_PER_MIN = 20;
/** Короче этого эпизод нагрузки не считаем. */
export const MIN_EPISODE_MIN = 10;
/** Соседние эпизоды с паузой до этого склеиваем. */
export const MERGE_GAP_MIN = 10;
/** Дырка между замерами больше этой интервал не перекрывает. */
export const MAX_SAMPLE_GAP_MIN = 45;

/** Веса комбинированной нагрузки часа: шаги и кардио. */
export const HOUR_LOAD_STEPS_WEIGHT = 0.5;
export const HOUR_LOAD_HR_WEIGHT = 0.5;

export const maxHeartRate = (age: number) => 208 - 0.7 * age;

/** Очки кардио за один замер: по тем же зонам, что и оценка активности. */
export const cardioPointsFor = (value: number, maxHr: number): number =>
  CARDIO_ZONES.find((z) => value / maxHr > z.from)?.points ?? 0;

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
  spo2: number[];
  /** Норма шагов этого дня (см. steps-norm.ts). Нет — 10 000. */
  stepGoal?: number;
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
  stateInputs: { hrv: boolean; restingHr: boolean; spo2: boolean };
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

export function sleepScore(night: SleepSession | null): number | null {
  if (!night) return null;
  const total = sleepMinutes(night);
  const volume = Math.min(100, (total / SLEEP_TARGET_MIN) * 100);
  const deepRatio = night.deepMin / total;
  const quality =
    deepRatio >= DEEP_RATIO_BEST.from && deepRatio <= DEEP_RATIO_BEST.to
      ? 100
      : Math.max(0, 100 - Math.abs((DEEP_RATIO_BEST.from + DEEP_RATIO_BEST.to) / 2 - deepRatio) * 400);
  return volume * SLEEP_VOLUME_WEIGHT + quality * (1 - SLEEP_VOLUME_WEIGHT);
}

export function cardioPoints(heart: Sample[], age: number | null): number | null {
  if (age === null || !heart.length) return null;
  const maxHr = maxHeartRate(age);
  const items = [...heart].sort((a, b) => a.ts - b.ts);
  let points = 0;
  items.forEach((s, i) => {
    const next = items[i + 1];
    const minutes = next ? Math.min((next.ts - s.ts) / 60, CARDIO_REFERENCE_MIN) : CARDIO_REFERENCE_MIN;
    points += cardioPointsFor(s.value, maxHr) * (minutes / CARDIO_REFERENCE_MIN);
  });
  return points;
}

/** Активность: шаги ведут итог (растёт в течение дня); интенсивный пульс — бонус. Нет шагов — нет оценки. */
export function activityScore(
  steps: number | null,
  heart: Sample[],
  age: number | null,
  /** Норма шагов дня; по умолчанию 10 000. */
  stepGoal: number = STEPS_DEFAULT_NORM,
): number | null {
  if (steps === null) return null;
  const stepScore = Math.min(100, (steps / stepGoal) * 100);
  const bonus = cardioPoints(heart, age) ?? 0;
  return Math.min(100, stepScore * STEPS_WEIGHT + bonus * CARDIO_WEIGHT);
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

/** Сколько входов из трёх нужно, чтобы выставить оценку «организма». */
export const STATE_MIN_INPUTS = 2;
/** Кислород: 100 при этом значении и выше. */
export const SPO2_TARGET = 95;
export const SPO2_PENALTY = 20;

/**
 * «Организм» — среднее доступных оценок: вариабельность, пульс во сне и кислород.
 * Нужны хотя бы два входа: по одному оценка получалась бы на пустом месте.
 */
export function stateScore(hrv: number[], restingHr: RestingHr | null, spo2: number[] = []): number | null {
  const parts: number[] = [];
  if (hrv.length) parts.push(Math.min(100, (avg(hrv) / HRV_TARGET) * 100));
  // Нет ночи — берём минимум за день: он хуже, но лучше, чем совсем без входа.
  if (restingHr) {
    parts.push(clamp(100 - Math.max(0, restingHr.value - RESTING_HR_TARGET) * RESTING_HR_PENALTY));
  }
  if (spo2.length) {
    const a = avg(spo2);
    parts.push(a >= SPO2_TARGET ? 100 : clamp(100 - (SPO2_TARGET - a) * SPO2_PENALTY));
  }
  return parts.length >= STATE_MIN_INPUTS ? avg(parts) : null;
}

export function computeDayScore(input: ScoreInput): DayScore {
  const restingHr = restingHeartRate(input.heart, input.night);
  const scores: Record<ComponentId, number | null> = {
    sleep: sleepScore(input.night),
    activity: activityScore(input.steps, input.heart, input.age, input.stepGoal),
    state: stateScore(input.hrv, restingHr, input.spo2),
  };
  // Итог — только когда посчитаны все три составляющие. По одной или двум он не строится:
  // «70 % активности» без сна и организма выглядел бы как оценка всего дня.
  const complete = (Object.keys(WEIGHTS) as ComponentId[]).every((k) => scores[k] !== null);
  const weightSum = WEIGHTS.sleep + WEIGHTS.activity + WEIGHTS.state;
  const comp = (k: ComponentId): ComponentScore => ({
    score: scores[k] === null ? null : Math.round(scores[k]),
    weight: scores[k] === null ? 0 : WEIGHTS[k] / weightSum,
  });
  const total = complete
    ? Math.round((Object.keys(WEIGHTS) as ComponentId[]).reduce((sum, k) => sum + WEIGHTS[k] * (scores[k] as number), 0) / weightSum)
    : null;
  return {
    total,
    sleep: comp('sleep'),
    activity: comp('activity'),
    state: comp('state'),
    restingHr,
    stateInputs: { hrv: input.hrv.length > 0, restingHr: restingHr !== null, spo2: input.spo2.length > 0 },
  };
}
