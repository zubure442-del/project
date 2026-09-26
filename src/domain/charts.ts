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

const NICE_STEPS = [1, 2, 2.5, 5];

/**
 * Вертикальная ось статичного графика: 3–4 круглые отметки, крайние охватывают данные.
 * `fixed` — границы, которые должны войти всегда (например, 0–100 у стресса).
 */
export function chartAxis(min: number, max: number, fixed?: { min?: number; max?: number }): { lo: number; hi: number; ticks: number[] } {
  let a = Math.min(min, fixed?.min ?? min);
  let b = Math.max(max, fixed?.max ?? max);
  if (!(b > a)) {
    const pad = Math.max(1, Math.abs(a) * 0.1);
    a -= pad;
    b += pad;
  }
  const magnitude = 10 ** Math.floor(Math.log10((b - a) / 3));
  const candidates = [magnitude / 10, magnitude, magnitude * 10].flatMap((m) => NICE_STEPS.map((k) => k * m));
  for (const step of candidates) {
    const lo = Math.floor(a / step + 1e-9) * step;
    const hi = Math.ceil(b / step - 1e-9) * step;
    const n = Math.round((hi - lo) / step) + 1;
    if (n <= 4) {
      const ticks = Array.from({ length: n }, (_, i) => Math.round((lo + i * step) * 1000) / 1000);
      return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks };
    }
  }
  return { lo: a, hi: b, ticks: [a, b] };
}

/** Часы на оси X статичных графиков дня. */
export const DAY_HOUR_TICKS = [0, 360, 720, 1080, 1440];

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
  const last = stepsPerHour.length - 1;
  const cardio = new Array<number>(stepsPerHour.length).fill(0);
  if (maxHr !== null && last >= 0) {
    for (const p of heart) cardio[Math.max(0, Math.min(last, Math.floor(p.m / 60)))] += cardioPointsFor(p.v, maxHr);
  }
  const maxSteps = Math.max(...stepsPerHour, 0);
  const maxCardio = Math.max(...cardio, 0);
  if (maxSteps === 0 && maxCardio === 0) return null;

  let best = 0;
  let bestLoad = -1;
  for (let hour = 0; hour < stepsPerHour.length; hour++) {
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
 * Самый активный час вдоль цикла бодрствования — по тем же рядам, что нарисованы на графике «День»
 * (минуты от полуночи даты цикла, после полуночи — больше 1440). Считать его по календарным суткам
 * нельзя: в 3 часа ночи у суток только ночные минуты, и «самым активным» выходил час после полуночи,
 * хотя на графике днём были прогулки. Ответ — час на циферблате, 0–23.
 */
export function busiestCycleHour(
  steps: { m: number; v: number }[],
  heart: { m: number; v: number }[],
  age: number | null,
  from: number,
  to: number,
): number | null {
  if (!(to >= from)) return null;
  const first = Math.floor(from / 60);
  const perHour = new Array<number>(Math.floor(to / 60) - first + 1).fill(0);
  for (const p of steps) if (p.m >= from && p.m <= to) perHour[Math.floor(p.m / 60) - first] += p.v;
  const inside = heart.filter((p) => p.m >= from && p.m <= to).map((p) => ({ m: p.m - first * 60, v: p.v }));
  const best = busiestHour(perHour, inside, age);
  return best === null ? null : (((first + best) % 24) + 24) % 24;
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

/** Квадратики нагрузки на графике «День». */
export const LOAD_BOX_MIN_WIDTH = 6;
/** Высота самого маленького эпизода и доля области графика для самого большого. */
export const LOAD_BOX_H_MIN = 14;
export const LOAD_BOX_H_MAX_SHARE = 0.8;
/** Ниже этой высоты квадратик не сжимаем даже ради границ. */
export const LOAD_BOX_H_FLOOR = 10;

/** Пульс линии в минуту m: между соседними точками — линейно; снаружи — по двум ближайшим, без выхода за их значения. */
export function pulseAt(line: readonly { m: number; v: number }[], m: number): number | null {
  if (!line.length) return null;
  if (line.length === 1) return line[0].v;
  const after = line.findIndex((p) => p.m >= m);
  if (after > 0) {
    const a = line[after - 1];
    const b = line[after];
    return b.m === a.m ? b.v : a.v + ((b.v - a.v) * (m - a.m)) / (b.m - a.m);
  }
  if (after === 0) return line[0].v;
  return line[line.length - 1].v;
}

export interface LoadBox {
  x: number;
  width: number;
  /** Центр по вертикали — на линии пульса в середине эпизода. */
  cy: number;
  height: number;
}

/**
 * Квадратики эпизодов: по ширине — от начала до конца эпизода, центр — на линии пульса
 * в середине эпизода, высота растёт с числом шагов. Общий коэффициент сжатия сохраняет
 * пропорции и не даёт квадратикам выйти за область графика.
 */
export function loadBoxes(
  zones: readonly { from: number; to: number; steps: number }[],
  line: readonly { m: number; v: number }[],
  x: (m: number) => number,
  y: (v: number) => number,
  plot: { top: number; bottom: number },
): LoadBox[] {
  const hMax = LOAD_BOX_H_MAX_SHARE * (plot.bottom - plot.top);
  const stepsMax = Math.max(0, ...zones.map((z) => z.steps));
  const raw = zones.flatMap((z) => {
    const pulse = pulseAt(line, (z.from + z.to) / 2);
    if (pulse === null) return [];
    const left = x(z.from);
    const share = stepsMax > 0 ? z.steps / stepsMax : 0;
    return [{
      x: left,
      width: Math.max(LOAD_BOX_MIN_WIDTH, x(z.to) - left),
      cy: y(pulse),
      height: LOAD_BOX_H_MIN + share * (hMax - LOAD_BOX_H_MIN),
    }];
  });
  const room = (b: { cy: number; height: number }) => (2 * Math.min(b.cy - plot.top, plot.bottom - b.cy)) / b.height;
  const scale = Math.min(1, ...raw.map(room));
  return raw.map((b) => ({ ...b, height: Math.max(LOAD_BOX_H_FLOOR, b.height * scale) }));
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
