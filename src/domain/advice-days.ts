import { coffeeClock } from './coffee';
import { markNotMeal, type NotMealContext } from './glucose';

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
  /** Минуты бодрствования внутри сна (пробуждения ночью); фаз нет — null. */
  awakeMin: number | null;
  /** Средний пульс во сне. */
  nightPulse: number | null;
  hrv: number | null;
  restingPulse: number | null;
  /**
   * Обычный пульс днём в покое: медиана дневных замеров (8:00–22:00, вне сна), рядом с которыми
   * за полчаса почти не было шагов. С ним «Мнение Лиса» сравнивает пульс сейчас: пульс покоя берётся
   * из сна, и днём любой пульс выходил «заметно выше обычного» (владелец 26.09).
   */
  quietPulse: number | null;
  spo2: number | null;
  /** Средний кислород внутри сна дня: просадка ночью объясняет разбитость днём. */
  nightSpo2: number | null;
  /** Давление по оценке кольца — среднее за день (до выгрузки у сегодняшнего). */
  systolic: number | null;
  diastolic: number | null;
  /** Размах сахара за день (максимум − минимум, ммоль/л, до 0.1): насколько он «скакал». От трёх замеров. */
  glucoseRange: number | null;
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
  sleepSegments: readonly { from: number; to: number; stage?: string }[];
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
  summaryPoints: readonly { m: number; glucose: number | null; systolic?: number | null; diastolic?: number | null }[];
  /** Пульс и шаги по минутам — для обычного пульса днём в покое; нет — `quietPulse` null. */
  heart?: readonly MinutePoint[];
  stepsByMinute?: readonly MinutePoint[];
}

/** Обычный пульс днём в покое: окно дня, «почти без шагов» за полчаса до замера, сколько замеров нужно. */
export const QUIET_FROM = 8 * 60;
export const QUIET_TO = 22 * 60;
export const QUIET_STEPS = 100;
export const QUIET_MIN_POINTS = 3;

/** Медиана дневных замеров пульса, рядом с которыми почти не было шагов (вне сна, до `until`). */
export function quietPulse(
  heart: readonly MinutePoint[],
  steps: readonly MinutePoint[],
  sleep: readonly { from: number; to: number }[],
  until = 1440,
): number | null {
  const values = heart
    .filter((p) => p.m >= QUIET_FROM && p.m <= Math.min(QUIET_TO, until) && !sleep.some((s) => p.m >= s.from && p.m <= s.to))
    .filter((p) => steps.filter((s) => s.m > p.m - 30 && s.m <= p.m).reduce((a, s) => a + s.v, 0) < QUIET_STEPS)
    .map((p) => p.v)
    .sort((a, b) => a - b);
  if (values.length < QUIET_MIN_POINTS) return null;
  const mid = Math.floor(values.length / 2);
  return Math.round(values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2);
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

/**
 * Начала подъёмов глюкозы за день (минуты): замер выше порога после замера ниже него.
 * Подъём во сне и на интенсивной нагрузке — не еда (`markNotMeal`, владелец 26.09): его нет
 * в списке, и продолжение такого подъёма после пробуждения завтраком тоже не считается.
 */
export function glucoseRises(points: readonly MinutePoint[], level: number, notMeal: NotMealContext | null = null): number[] {
  const threshold = level * (1 + MEAL_RISE_SHARE);
  const high = (v: number) => v >= threshold;
  const sorted = notMeal
    ? markNotMeal(points, notMeal, high, level)
    : [...points].sort((a, b) => a.m - b.m).map((p) => ({ ...p, notMeal: null }));
  return sorted
    .filter((p, i) => {
      if (!high(p.v) || p.notMeal !== null) return false;
      const prev = sorted[i - 1];
      return !prev || p.m - prev.m > MEAL_RISE_GAP_MIN || !high(prev.v);
    })
    .map((p) => p.m);
}

/**
 * Строка таблицы по сводке дня. `upTo` — для сегодняшнего дня: до какой минуты есть данные
 * (стресс и подъёмы считаем только до неё); `glucoseLevel` — обычный уровень глюкозы человека;
 * `notMeal` — сон и интенсивная нагрузка дня: подъёмы там приёмами пищи не считаются.
 */
export function adviceDay(
  ago: number,
  day: AdviceDayInput,
  glucoseLevel: number,
  upTo: number | null = null,
  notMeal: NotMealContext | null = null,
): AdviceDay {
  const until = upTo ?? 1440;
  const segments = day.sleepSegments;
  const glucose = day.summaryPoints
    .filter((p) => p.glucose !== null && p.m <= until)
    .map((p) => ({ m: p.m, v: p.glucose as number }));
  const pressure = day.summaryPoints.filter((p) => p.m <= until);
  const values = (pick: (p: (typeof pressure)[number]) => number | null | undefined) =>
    pressure.map(pick).filter((v): v is number => typeof v === 'number');
  const inSleep = (m: number) => segments.some((s) => m >= s.from && m <= s.to);
  const g = glucose.map((p) => p.v);
  return {
    ago,
    asleep: segments.length ? coffeeClock(Math.min(...segments.map((s) => s.from))) : null,
    awake: segments.length ? coffeeClock(Math.max(...segments.map((s) => s.to))) : null,
    sleepMin: day.sleep?.totalMin ?? null,
    deepMin: day.sleep?.deepMin ?? null,
    awakeMin: segments.length && segments.every((s) => s.stage !== undefined)
      ? segments.filter((s) => s.stage === 'awake').reduce((a, s) => a + s.to - s.from, 0)
      : null,
    nightPulse: round(day.nightHr?.avg),
    hrv: round(day.estimates.hrv),
    restingPulse: round(day.restingHr),
    quietPulse: day.heart && day.stepsByMinute ? quietPulse(day.heart, day.stepsByMinute, segments, until) : null,
    spo2: round(mean(day.spo2.map((p) => p.v))),
    nightSpo2: round(mean(day.spo2.filter((p) => inSleep(p.m)).map((p) => p.v))),
    systolic: round(mean(values((p) => p.systolic))),
    diastolic: round(mean(values((p) => p.diastolic))),
    glucoseRange: g.length >= 3 ? Math.round((Math.max(...g) - Math.min(...g)) * 10) / 10 : null,
    stress: round(mean(day.stress.filter((p) => p.m >= DAY_STRESS_FROM && p.m <= Math.min(DAY_STRESS_TO, until)).map((p) => p.v))),
    steps: day.steps,
    stepNorm: day.stepNorm?.value ?? null,
    calories: day.calories ?? null,
    load: round(day.load?.trimp),
    workout: day.load?.session ?? null,
    meals: glucoseRises(glucose, glucoseLevel, notMeal).map(coffeeClock),
  };
}
