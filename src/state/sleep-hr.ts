import { SLEEP_HR_BASELINE_DAYS, sleepHrBaseline, sleepHrCheck, type SleepHrView } from '../domain';
import { profileAge, type VueloState } from '../storage';
import { findDay } from './day';

/**
 * Пульс во сне за выбранный день и что про него написать: возрастные границы
 * (возраст — из профиля) и своя норма по прошлым ночам.
 */
export function sleepHrFor(state: VueloState, date: string, now = new Date()): SleepHrView | null {
  const day = findDay(state.days, date);
  const value = day?.restingHrSource === 'night' ? day.restingHr : null;
  const nights = state.days
    .filter((d) => d.date < date && d.restingHrSource === 'night' && d.restingHr !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-SLEEP_HR_BASELINE_DAYS)
    .map((d) => d.restingHr as number);
  return sleepHrCheck(value, profileAge(state.profile, now), sleepHrBaseline(nights));
}
