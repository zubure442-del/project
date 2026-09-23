import {
  FOOD_BASELINE_DAYS,
  FOOD_BASELINE_MIN_READINGS,
  flaskState,
  flaskStats,
  median,
  nightGlucose,
  type FoodInput,
  type GlucosePoint,
} from '../domain';
import type { DaySnapshot, VueloState } from '../storage';
import { findDay, todayKey } from './day';

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
 * Данные для «Цикла питания» — только по сегодняшней ночи, как у «Кофейного окна»:
 * без оценки сна за сегодня карточки нет вовсе. Глюкоза необязательна: без неё режим
 * выбирается по сну, а расписание и счётчик аутофагии считаются как обычно.
 */
export function foodInput(state: VueloState, now = new Date()): FoodInput | null {
  const today = todayKey(now);
  const day = findDay(state.days, today);
  const sleepScore = day?.scores.sleep ?? null;
  if (!day || sleepScore === null || !day.sleepSegments.length) return null;

  // Личная норма «натощак»: медиана ночной глюкозы за последние семь дней.
  const readings = Array.from({ length: FOOD_BASELINE_DAYS }, (_, i) =>
    nightOf(findDay(state.days, shiftDate(today, -(FOOD_BASELINE_DAYS - 1 - i)))),
  ).flat();
  const baseline = readings.length >= FOOD_BASELINE_MIN_READINGS ? median(readings) : null;

  // Колба: личные константы по неделе, уровень — по вчерашним и сегодняшним замерам на одной оси.
  const week = Array.from({ length: FOOD_BASELINE_DAYS }, (_, i) =>
    findDay(state.days, shiftDate(today, -(FOOD_BASELINE_DAYS - 1 - i))),
  );
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const flask = flaskState({
    points: [...glucoseOf(findDay(state.days, shiftDate(today, -1)), -1440), ...glucoseOf(day)],
    nowMinute,
    stats: flaskStats(week.map((d) => glucoseOf(d))),
    calories: day.calories ?? null,
  });

  return {
    wakeMinute: day.sleepSegments[day.sleepSegments.length - 1].to,
    sleepOnset: day.sleepSegments[0].from,
    sleepScore,
    glucose: median(nightOf(day)),
    baseline,
    flask,
    nowMinute,
  };
}
