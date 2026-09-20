import { wallClock, type Sample } from '../codec';
import { DEEP_MIN_STATE } from './sleep';
import {
  ACTIVE_HR_LOW_RATIO,
  ACTIVE_HR_OVER_RESTING,
  STEP_MIN_PER_MIN,
  HOUR_LOAD_HR_WEIGHT,
  HOUR_LOAD_STEPS_WEIGHT,
  MERGE_GAP_MIN,
  MIN_EPISODE_MIN,
  cardioPointsFor,
  maxHeartRate,
} from './score';

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

/**
 * Зоны стресса, как в официальном приложении кольца: 0–30, 31–60, 61–80, 81–100.
 * Названия нейтральные: это оценка кольца по пульсовой волне, а не медицинский показатель.
 */
export const STRESS_ZONES = [
  { upTo: 30, label: 'Низкий' },
  { upTo: 60, label: 'Умеренный' },
  { upTo: 80, label: 'Повышенный' },
  { upTo: 100, label: 'Высокий' },
] as const;

export const STRESS_ZONE_BOUNDS = [30, 60, 80];

export function stressZone(value: number): string | null {
  if (!(value > 0) || value > 100) return null;
  return (STRESS_ZONES.find((z) => value <= z.upTo) ?? STRESS_ZONES[STRESS_ZONES.length - 1]).label;
}

/**
 * Самый активный час: шаги и пульс вместе, иначе тренировка без шагов не находится.
 * нагрузка = W_STEPS × шаги_часа / макс_шагов + W_HR × очки_часа / макс_очков
 */
export function busiestHour(
  stepsPerHour: number[],
  heart: { m: number; v: number }[],
  age: number | null,
): number | null {
  const maxHr = age === null ? null : maxHeartRate(age);
  const cardio = new Array<number>(24).fill(0);
  if (maxHr !== null) {
    for (const p of heart) cardio[Math.min(23, Math.floor(p.m / 60))] += cardioPointsFor(p.v, maxHr);
  }
  const maxSteps = Math.max(...stepsPerHour, 0);
  const maxCardio = Math.max(...cardio, 0);
  if (maxSteps === 0 && maxCardio === 0) return null;

  let best = 0;
  let bestLoad = -1;
  for (let hour = 0; hour < 24; hour++) {
    const load =
      HOUR_LOAD_STEPS_WEIGHT * (maxSteps ? stepsPerHour[hour] / maxSteps : 0) +
      HOUR_LOAD_HR_WEIGHT * (maxCardio ? cardio[hour] / maxCardio : 0);
    if (load > bestLoad) {
      bestLoad = load;
      best = hour;
    }
  }
  return bestLoad > 0 ? best : null;
}

/**
 * Эпизоды нагрузки: минуты, где много шагов, плюс интервалы с поднятым пульсом.
 * Только по пульсу мало: кольцо мерит его раз в 30 минут и прогулку может пропустить,
 * поэтому шаги по минутам — основной признак, а пульс добавляет тренировки без шагов.
 */
export function loadIntervals(
  heart: { m: number; v: number }[],
  age: number | null,
  stepsPerMinute: { m: number; v: number }[] = [],
  restingHr: number | null = null,
): { from: number; to: number; peak: number | null; low: number | null; steps: number }[] {
  const active = new Set<number>();

  for (const s of stepsPerMinute) {
    if (s.v >= STEP_MIN_PER_MIN) active.add(s.m);
  }

  if (age !== null) {
    const maxHr = maxHeartRate(age);
    const threshold = Math.max(
      maxHr * ACTIVE_HR_LOW_RATIO,
      restingHr === null ? 0 : restingHr + ACTIVE_HR_OVER_RESTING,
    );
    const hot = heart.filter((p) => p.v >= threshold).sort((a, b) => a.m - b.m);
    // Замер покрывает окно до следующего: кольцо мерит редко.
    for (const p of hot) active.add(p.m);
  }

  const minutes = [...active].sort((a, b) => a - b);
  const groups: { from: number; to: number }[] = [];
  for (const m of minutes) {
    const last = groups[groups.length - 1];
    if (last && m - last.to <= MERGE_GAP_MIN) last.to = m;
    else groups.push({ from: m, to: m });
  }

  return groups
    .filter((g) => g.to - g.from >= MIN_EPISODE_MIN)
    .map((g) => {
      const inside = heart.filter((p) => p.m >= g.from && p.m <= g.to).map((p) => p.v);
      const steps = stepsPerMinute
        .filter((s) => s.m >= g.from && s.m <= g.to)
        .reduce((sum, s) => sum + s.v, 0);
      return {
        from: g.from,
        to: g.to,
        peak: inside.length ? Math.max(...inside) : null,
        low: inside.length ? Math.min(...inside) : null,
        steps,
      };
    });
}

/** Уровни волны сна: глубокий внизу, лёгкий вверху. */
export const SLEEP_LEVEL: Record<'light' | 'deep', number> = { light: 0.35, deep: 1 };
/** Окно сглаживания волны сна, минуты. */
export const SLEEP_SMOOTH_MIN = 20;

/**
 * Волна сна: уровень фазы по минутам, сглаженный скользящим средним.
 * Ничего кроме глубокого и лёгкого сна кольцо не различает, поэтому других фаз здесь нет.
 */
export function sleepWave(
  segments: { from: number; to: number; stage: SleepStage }[],
  smoothMin = SLEEP_SMOOTH_MIN,
): { m: number; v: number }[] {
  const real = segments.filter((s) => s.stage !== 'awake');
  if (!real.length) return [];
  const from = Math.min(...real.map((s) => s.from));
  const to = Math.max(...real.map((s) => s.to));
  const raw: number[] = [];
  for (let m = from; m < to; m++) {
    const seg = real.find((s) => m >= s.from && m < s.to);
    raw.push(seg ? SLEEP_LEVEL[seg.stage as 'light' | 'deep'] : SLEEP_LEVEL.light);
  }
  const half = Math.max(1, Math.round(smoothMin / 2));
  return raw.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(raw.length, i + half + 1);
    const window = raw.slice(lo, hi);
    return { m: from + i, v: window.reduce((a, b) => a + b, 0) / window.length };
  });
}

/** Ярлык доли глубокого сна. Пороги в процентах от всего сна. */
export const DEEP_SHARE_STEPS = [
  { below: 10, label: 'мало' },
  { below: 15, label: 'нормально' },
  { below: 20, label: 'хорошо' },
] as const;
export const DEEP_SHARE_BEST = 'отлично';

export function deepShareLabel(percent: number): string {
  return (DEEP_SHARE_STEPS.find((s) => percent < s.below)?.label ?? DEEP_SHARE_BEST);
}
