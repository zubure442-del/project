import { sleepHrBaseline, sleepHrCheck, type SleepHrView } from '../domain';
import { profileAge, type VueloState } from '../storage';
import { findDay } from './day';

/**
 * Пульс во сне за выбранный день и что про него написать: своя норма по всем ночам
 * в кэше, а во вторую очередь — возрастные границы (возраст из профиля).
 */
export function sleepHrFor(state: VueloState, date: string, now = new Date()): SleepHrView | null {
  const day = findDay(state.days, date);
  const value = day?.restingHrSource === 'night' ? day.restingHr : null;
  const nights = state.days
    .filter((d) => d.date < date && d.restingHrSource === 'night' && d.restingHr !== null)
    .map((d) => d.restingHr as number);
  return sleepHrCheck(value, profileAge(state.profile, now), sleepHrBaseline(nights));
}
