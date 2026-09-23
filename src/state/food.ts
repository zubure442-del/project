import {
  FOOD_BASELINE_DAYS,
  FOOD_BASELINE_MIN_READINGS,
  fastingStart,
  median,
  nightGlucose,
  type FoodInput,
} from '../domain';
import type { DaySnapshot, VueloState } from '../storage';
import { findDay, todayKey } from './day';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Ночные замеры глюкозы одного дня: внутри сна и без активности рядом. */
const nightOf = (day: DaySnapshot | null): number[] =>
  day ? nightGlucose(day.summaryPoints, day.sleepSegments, day.stepsByMinute) : [];

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

  // Точка отсчёта голодания — по вчерашнему вечеру и сегодняшней ночи на одной оси.
  const yesterday = findDay(state.days, shiftDate(today, -1));
  const points = [
    ...(yesterday?.summaryPoints ?? []).map((p) => ({ m: p.m - 1440, glucose: p.glucose })),
    ...day.summaryPoints.map((p) => ({ m: p.m, glucose: p.glucose })),
  ];
  const sleepOnset = day.sleepSegments[0].from;

  return {
    wakeMinute: day.sleepSegments[day.sleepSegments.length - 1].to,
    sleepOnset,
    sleepScore,
    glucose: median(nightOf(day)),
    baseline,
    fastingStart: fastingStart(points, sleepOnset),
    nowMinute: now.getHours() * 60 + now.getMinutes(),
  };
}
