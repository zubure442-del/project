import { SLEEP_HR_BASELINE_DAYS, sleepHrBaseline, sleepHrCheck, type NightHr, type SleepHrView } from '../domain';
import type { VueloState } from '../storage';
import { findDay } from './day';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Пульс во сне за выбранный день: минимальный и средний против своей нормы.
 * Норма — по ночам семи предыдущих дней из кэша, ровно как при пересчёте сводок (build.ts),
 * поэтому карточка и коэффициент оценки сна всегда говорят об одном и том же.
 */
export function sleepHrFor(state: VueloState, date: string): SleepHrView | null {
  const night = findDay(state.days, date)?.nightHr ?? null;
  const nights = Array.from({ length: SLEEP_HR_BASELINE_DAYS }, (_, i) =>
    findDay(state.days, shiftDate(date, -(SLEEP_HR_BASELINE_DAYS - i)))?.nightHr ?? null,
  ).filter((v): v is NightHr => v !== null);
  return sleepHrCheck(night, sleepHrBaseline(nights));
}
