import { SLEEP_HR_BASELINE_DAYS, sleepHrBaseline, sleepHrCheck, type NightHr, type SleepHrView } from '../domain';
import type { VueloState } from '../storage';
import { currentCycle } from './cycle';
import { findDay, todayKey } from './day';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Пульс во сне: минимальный и средний против своей нормы.
 * Сегодня — сон текущего цикла и норма по снам циклов семи предыдущих дней (как при сборке цикла,
 * build.ts), поэтому карточка и коэффициент оценки сна говорят об одном. Прошлый день — его ночь
 * и ночи семи дней до него.
 */
export function sleepHrFor(state: VueloState, date: string, now = new Date()): SleepHrView | null {
  if (date === todayKey(now)) {
    const cycle = currentCycle(state);
    if (!cycle) return null;
    const nights = state.cycles
      .filter((c) => c !== cycle && c.date < cycle.date && c.date >= shiftDate(cycle.date, -SLEEP_HR_BASELINE_DAYS))
      .map((c) => c.nightHr)
      .filter((v): v is NightHr => v !== null);
    return sleepHrCheck(cycle.nightHr, sleepHrBaseline(nights));
  }
  const night = findDay(state.days, date)?.nightHr ?? null;
  const nights = Array.from({ length: SLEEP_HR_BASELINE_DAYS }, (_, i) =>
    findDay(state.days, shiftDate(date, -(SLEEP_HR_BASELINE_DAYS - i)))?.nightHr ?? null,
  ).filter((v): v is NightHr => v !== null);
  return sleepHrCheck(night, sleepHrBaseline(nights));
}
