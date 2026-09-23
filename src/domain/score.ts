import { STEPS_DEFAULT_NORM } from './steps-norm';
import type { Sample } from '../codec/types';
import { smoothHeart } from './heart';
import { applySleepHrFactor } from './sleep-hr';
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
export const DEEP_RATIO_BEST = { from: 0.15, to: 0.25 } as const;
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
  /** Для оценки сна: прошлые подъёмы и вчерашняя активность. */
  sleepContext?: SleepContext;
  /** «Организм» v2, посчитанный по замерам дня (organism.ts); null — покрытия не хватило. */
  organism: number | null;
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
}


/** Новая модель сна: длительность, глубина и время пробуждения; сверху — бонус за вчерашнюю активность. */
export const SLEEP_WEIGHTS = { duration: 0.45, depth: 0.25, wake: 0.2 } as const;
/** Пробуждение: 5:00 и раньше — 100, 11:00 и позже — 0 (минуты от полуночи). */
export const WAKE_EARLY_REF = 300;
export const WAKE_LATE_REF = 660;
/** Постоянство считаем, если за последние 7 дней есть хотя бы 3 предыдущих ночи. */
export const CONSISTENCY_WINDOW_DAYS = 7;
export const CONSISTENCY_MIN_DAYS = 3;
/** Разброс подъёма в полтора часа обнуляет постоянство. */
export const CONSISTENCY_K = 100 / 90;
export const EARLINESS_SHARE = 0.6;
export const ACTIVITY_SLEEP_BONUS_MAX = 10;

const clampScore = (x: number) => Math.min(100, Math.max(0, x));

/** Длительность: минуты сна к цели. */
export const sleepDurationScore = (night: SleepSession) => Math.min(100, (sleepMinutes(night) / SLEEP_TARGET_MIN) * 100);

/** Глубина: доля глубокого сна в лучшем коридоре — 100, дальше по штрафу. */
export function sleepDepthScore(night: SleepSession): number {
  const deepRatio = night.deepMin / sleepMinutes(night);
  return deepRatio >= DEEP_RATIO_BEST.from && deepRatio <= DEEP_RATIO_BEST.to
    ? 100
    : Math.max(0, 100 - Math.abs((DEEP_RATIO_BEST.from + DEEP_RATIO_BEST.to) / 2 - deepRatio) * 400);
}

/** Ранность подъёма: W — время пробуждения в минутах от полуночи. */
export const earliness = (wakeMinute: number) =>
  clampScore((100 * (WAKE_LATE_REF - wakeMinute)) / (WAKE_LATE_REF - WAKE_EARLY_REF));

/** Постоянство подъёма: разброс времени пробуждения за предыдущие дни и сегодня. Мало истории — null. */
export function wakeConsistency(previousWakes: readonly number[], wakeMinute: number): number | null {
  if (previousWakes.length < CONSISTENCY_MIN_DAYS) return null;
  const all = [...previousWakes, wakeMinute];
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const stdev = Math.sqrt(all.reduce((sum, v) => sum + (v - mean) ** 2, 0) / all.length);
  return clampScore(100 - stdev * CONSISTENCY_K);
}

/** Компонент пробуждения: 0.6 × ранность + 0.4 × постоянство; без постоянства — только ранность. */
export function wakeComponent(wakeMinute: number, previousWakes: readonly number[] = []): number {
  const early = earliness(wakeMinute);
  const steady = wakeConsistency(previousWakes, wakeMinute);
  return steady === null ? early : EARLINESS_SHARE * early + (1 - EARLINESS_SHARE) * steady;
}

/** Бонус к сну за вчерашнюю активность: до 10 баллов; нет вчерашней оценки — 0. */
export const activitySleepBonus = (yesterdayActivity: number | null | undefined) =>
  yesterdayActivity == null ? 0 : (clampScore(yesterdayActivity) / 100) * ACTIVITY_SLEEP_BONUS_MAX;

export interface SleepContext {
  /** Время пробуждения за предыдущие дни (до 7), минуты от полуночи. */
  previousWakes?: number[];
  /** Оценка активности вчера. */
  yesterdayActivity?: number | null;
  /** Коэффициент по ночному пульсу (см. sleep-hr.ts). Своей нормы нет — 1. */
  nightHrFactor?: number;
}

/** Минута пробуждения — конец ночи по «настенному» времени кольца. */
export const wakeMinuteOf = (night: SleepSession) => {
  const minute = Math.floor(night.end / 60) % 1440;
  return minute < 0 ? minute + 1440 : minute;
};

/**
 * Оценка сна = clamp(0.45 × длительность + 0.25 × глубина + 0.20 × пробуждение + бонус, 0, 100),
 * а сверху — коэффициент по ночному пульсу (sleep-hr.ts). Итог всё равно не больше 100 очков.
 */
export function sleepScore(night: SleepSession | null, context: SleepContext = {}): number | null {
  if (!night || sleepMinutes(night) === 0) return null;
  const weighted =
    SLEEP_WEIGHTS.duration * sleepDurationScore(night) +
    SLEEP_WEIGHTS.depth * sleepDepthScore(night) +
    SLEEP_WEIGHTS.wake * wakeComponent(wakeMinuteOf(night), context.previousWakes);
  const base = clampScore(weighted + activitySleepBonus(context.yesterdayActivity));
  return applySleepHrFactor(base, context.nightHrFactor ?? 1);
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

/** Кислород: 100 при этом значении и выше (порог из ALGORITHMS.md). */
export const SPO2_TARGET = 95;
export const SPO2_PENALTY = 20;

export function computeDayScore(input: ScoreInput): DayScore {
  const restingHr = restingHeartRate(input.heart, input.night);
  const scores: Record<ComponentId, number | null> = {
    sleep: sleepScore(input.night, input.sleepContext),
    activity: activityScore(input.steps, input.heart, input.age, input.stepGoal),
    state: input.organism,
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
  };
}
