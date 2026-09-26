import { coffeeClock } from './coffee';

/**
 * Числа последних дней для «Мнения Лиса» (решение владельца 26.09): модель получает не фразы
 * и не выводы, а таблицу — строку на день, как карту наблюдений. По ней она сама видит и сегодня,
 * и то, что копится несколько дней (напряжение, сбитый режим, хорошая серия), и пишет своё мнение.
 * На экран таблица не выводится.
 */

export interface MinutePoint {
  /** Минуты от полуночи. */
  m: number;
  v: number;
}

/** Одна строка таблицы. Нет данных — null; времена — «ЧЧ:ММ». */
export interface AdviceDay {
  /** Сколько дней назад: 0 — сегодня. */
  ago: number;
  asleep: string | null;
  awake: string | null;
  sleepMin: number | null;
  deepMin: number | null;
  /** Средний пульс во сне. */
  nightPulse: number | null;
  hrv: number | null;
  restingPulse: number | null;
  spo2: number | null;
  /** Средний стресс днём (9:00–21:00), шкала 0–100. */
  stress: number | null;
  /** Шаги после шумоподавления — как на экране — и норма дня. */
  steps: number | null;
  stepNorm: number | null;
  calories: number | null;
  /** Нагрузка по пульсу (TRIMP) и распознанная тренировка. */
  load: number | null;
  workout: 'cardio' | 'strength' | null;
  /** Когда начинались подъёмы глюкозы — обычно это еда. Значений глюкозы нет. */
  meals: string[];
}

/** Что нужно от сводки дня (совпадает с полями `DaySnapshot`). */
export interface AdviceDayInput {
  sleepSegments: readonly { from: number; to: number }[];
  sleep: { totalMin: number; deepMin: number } | null;
  nightHr?: { avg: number } | null;
  estimates: { hrv: number | null };
  restingHr: number | null;
  spo2: readonly MinutePoint[];
  stress: readonly MinutePoint[];
  steps: number | null;
  stepNorm?: { value: number };
  calories?: number | null;
  load?: { trimp: number; session: 'cardio' | 'strength' | null } | null;
  summaryPoints: readonly { m: number; glucose: number | null }[];
}

/** Подъём глюкозы — замер выше обычного уровня на столько (при уровне 6.0 — от 6.9). */
export const MEAL_RISE_SHARE = 0.15;
/** Подъём начинается, если предыдущий замер (не дальше 2 ч) был ниже порога. */
export const MEAL_RISE_GAP_MIN = 120;
/** Стресс «днём» — между этими минутами: ночной стресс кольцо пишет низким, он занижал бы среднее. */
export const DAY_STRESS_FROM = 9 * 60;
export const DAY_STRESS_TO = 21 * 60;

const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));

/** Начала подъёмов глюкозы за день (минуты): замер выше порога после замера ниже него. */
export function glucoseRises(points: readonly MinutePoint[], level: number): number[] {
  const threshold = level * (1 + MEAL_RISE_SHARE);
  const sorted = [...points].sort((a, b) => a.m - b.m);
  return sorted
    .filter((p, i) => {
      if (p.v < threshold) return false;
      const prev = sorted[i - 1];
      return !prev || p.m - prev.m > MEAL_RISE_GAP_MIN || prev.v < threshold;
    })
    .map((p) => p.m);
}

/**
 * Строка таблицы по сводке дня. `upTo` — для сегодняшнего дня: до какой минуты есть данные
 * (стресс и подъёмы считаем только до неё); `glucoseLevel` — обычный уровень глюкозы человека.
 */
export function adviceDay(ago: number, day: AdviceDayInput, glucoseLevel: number, upTo: number | null = null): AdviceDay {
  const until = upTo ?? 1440;
  const segments = day.sleepSegments;
  const glucose = day.summaryPoints
    .filter((p) => p.glucose !== null && p.m <= until)
    .map((p) => ({ m: p.m, v: p.glucose as number }));
  return {
    ago,
    asleep: segments.length ? coffeeClock(Math.min(...segments.map((s) => s.from))) : null,
    awake: segments.length ? coffeeClock(Math.max(...segments.map((s) => s.to))) : null,
    sleepMin: day.sleep?.totalMin ?? null,
    deepMin: day.sleep?.deepMin ?? null,
    nightPulse: round(day.nightHr?.avg),
    hrv: round(day.estimates.hrv),
    restingPulse: round(day.restingHr),
    spo2: round(mean(day.spo2.map((p) => p.v))),
    stress: round(mean(day.stress.filter((p) => p.m >= DAY_STRESS_FROM && p.m <= Math.min(DAY_STRESS_TO, until)).map((p) => p.v))),
    steps: day.steps,
    stepNorm: day.stepNorm?.value ?? null,
    calories: day.calories ?? null,
    load: round(day.load?.trimp),
    workout: day.load?.session ?? null,
    meals: glucoseRises(glucose, glucoseLevel).map(coffeeClock),
  };
}
