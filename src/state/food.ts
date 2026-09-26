import {
  FOOD_BASELINE_DAYS,
  FOOD_BASELINE_MIN_READINGS,
  flaskState,
  flaskStats,
  intenseSpans,
  median,
  sleepSpans,
  nightGlucose,
  type FoodInput,
  type GlucosePoint,
  type NotMealContext,
} from '../domain';
import { profileAge, type DaySnapshot, type VueloState } from '../storage';
import { cycleClock } from './cycle';
import { findDay } from './day';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Ночные замеры глюкозы одного дня: внутри сна и без активности рядом. */
const nightOf = (day: DaySnapshot | null): number[] =>
  day ? nightGlucose(day.summaryPoints, day.sleepSegments, day.stepsByMinute) : [];

/** Все замеры глюкозы дня; сдвиг нужен, чтобы вчерашние минуты легли на ось сегодняшнего дня. */
const glucoseOf = (day: DaySnapshot | null, shift = 0): GlucosePoint[] =>
  (day?.summaryPoints ?? [])
    .filter((p) => p.glucose !== null)
    .map((p) => ({ m: p.m + shift, v: p.glucose as number }));

/**
 * Где подъём глюкозы дня — не еда: отрезки сна и интенсивной нагрузки (`markNotMeal`). Минуты
 * сдвигаются так же, как замеры глюкозы, чтобы лечь на ось сегодняшнего дня.
 */
export function notMealOf(day: DaySnapshot | null, age: number | null, shift = 0): NotMealContext {
  if (!day) return { sleep: [], exercise: [] };
  const move = (s: { from: number; to: number }) => ({ from: s.from + shift, to: s.to + shift });
  return {
    sleep: sleepSpans(day.sleepSegments).map(move),
    exercise: intenseSpans(day.heart, day.stepsByMinute, age, day.restingHr).map(move),
  };
}

const joinContexts = (list: readonly NotMealContext[]): NotMealContext => ({
  sleep: list.flatMap((c) => c.sleep),
  exercise: list.flatMap((c) => c.exercise),
});

/**
 * Данные для «Цикла питания» — по сну текущего цикла бодрствования, как у «Кофейного окна»:
 * без цикла со сном и оценкой сна карточки нет вовсе. Минуты — от полуночи даты начала цикла
 * (после полуночи цикл продолжается, минут больше 1440). Глюкоза необязательна: без неё режим
 * выбирается по сну, а расписание и колба считаются как обычно.
 */
export function foodInput(state: VueloState, now = new Date()): FoodInput | null {
  const clock = cycleClock(state, now);
  if (!clock) return null;
  const { cycle, date, nowMinute, sleepScore } = clock;
  const day = findDay(state.days, date);
  const age = profileAge(state.profile, now) ?? state.age;

  // Личная норма «натощак»: медиана ночной глюкозы за последние семь дней.
  const readings = Array.from({ length: FOOD_BASELINE_DAYS }, (_, i) =>
    nightOf(findDay(state.days, shiftDate(date, -(FOOD_BASELINE_DAYS - 1 - i)))),
  ).flat();
  const baseline = readings.length >= FOOD_BASELINE_MIN_READINGS ? median(readings) : null;

  // Колба: личные константы по неделе, уровень — по замерам дня накануне и дня начала цикла на одной оси.
  const week = Array.from({ length: FOOD_BASELINE_DAYS }, (_, i) =>
    findDay(state.days, shiftDate(date, -(FOOD_BASELINE_DAYS - 1 - i))),
  );
  // Подъёмы глюкозы во сне и на интенсивной нагрузке — не еда (владелец 26.09): колба их пропускает.
  const before = findDay(state.days, shiftDate(date, -1));
  const after = findDay(state.days, shiftDate(date, 1));
  const flask = flaskState({
    points: [...glucoseOf(before, -1440), ...glucoseOf(day), ...glucoseOf(after, 1440)],
    nowMinute,
    stats: flaskStats(
      week.map((d) => glucoseOf(d)),
      week.map((d) => notMealOf(d, age)),
    ),
    calories: day?.calories ?? null,
    notMeal: joinContexts([notMealOf(before, age, -1440), notMealOf(day, age), notMealOf(after, age, 1440)]),
  });

  return {
    wakeMinute: cycle.sleepSegments[cycle.sleepSegments.length - 1].to,
    sleepOnset: cycle.sleepSegments[0].from,
    sleepScore,
    glucose: median(nightOf(day)),
    baseline,
    flask,
    nowMinute,
  };
}
