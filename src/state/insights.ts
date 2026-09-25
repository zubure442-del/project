import { dayInsights, type DayLoad, type MinutePoint } from '../domain';
import type { DaySnapshot, VueloState } from '../storage';
import { currentCycle } from './cycle';
import { findDay, todayKey } from './day';
import { sleepHrFor } from './sleep-hr';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
/** Прошлые дни: `count` календарных дней до `date`, самый старый первым. */
const daysBefore = (date: string, count: number) => Array.from({ length: count }, (_, i) => shiftDate(date, -(count - i)));

const glucoseOf = (day: DaySnapshot | null): MinutePoint[] =>
  (day?.summaryPoints ?? []).filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));

/**
 * Наблюдения для «Мнения Лиса» (`dayInsights`): сегодняшний день против своей нормы
 * за прошлую неделю — сон, пульс во сне, вариабельность, вчерашняя нагрузка, шаги, долгое
 * сидение, подъёмы глюкозы после еды, стресс. «Сегодня» — до времени последней выгрузки:
 * новых замеров после неё ещё нет, и сравнивать с «сейчас» было бы нечестно.
 */
export function insightsFor(state: VueloState, now = new Date()): string[] {
  const today = todayKey(now);
  const week = daysBefore(today, 7);
  const day = (date: string) => findDay(state.days, date);
  const todayDay = day(today);
  const synced = state.lastSyncAt === null ? null : new Date(state.lastSyncAt);
  const dataMinute = synced && todayKey(synced) === today ? synced.getHours() * 60 + synced.getMinutes() : null;

  // Сон: текущий цикл и главный (самый длинный) сон каждого из семи прошлых дней.
  const cycle = currentCycle(state);
  const rel = (ts: number, date: string) => Math.round((ts - midnight(date)) / 60);
  const nights = new Map<string, { asleep: number; totalMin: number; deepMin: number }>();
  for (const c of state.cycles) {
    if (!c.sleep || c === cycle || !week.includes(c.date)) continue;
    const known = nights.get(c.date);
    if (!known || c.sleep.totalMin > known.totalMin) {
      nights.set(c.date, { asleep: rel(c.sleep.start, c.date), totalMin: c.sleep.totalMin, deepMin: c.sleep.deepMin });
    }
  }
  const sleep = cycle?.sleep ?? null;

  const load = (date: string): DayLoad | null => state.training[date] ?? null;
  const yesterday = shiftDate(today, -1);

  return dayInsights({
    dataMinute,
    glucose: {
      today: glucoseOf(todayDay),
      yesterday: glucoseOf(day(yesterday)),
      history: week.map((d) => glucoseOf(day(d))),
    },
    sleep: {
      asleep: sleep && cycle ? rel(sleep.start, cycle.date) : null,
      totalMin: sleep?.totalMin ?? null,
      deepMin: sleep?.deepMin ?? null,
      history: [...nights.values()],
    },
    nightPulseDelta: sleepHrFor(state, today, now)?.deltaAvg ?? null,
    hrv: {
      today: todayDay?.estimates.hrv ?? null,
      history: week.map((d) => day(d)?.estimates.hrv ?? null).filter((v): v is number => v !== null),
    },
    steps: {
      today: todayDay?.stepsByMinute ?? [],
      history: week.map((d) => day(d)?.stepsByMinute ?? []),
      wake: sleep && cycle && cycle.date === today ? rel(sleep.end, today) : null,
    },
    stress: { today: todayDay?.stress ?? [], history: week.map((d) => day(d)?.stress ?? []) },
    load: {
      yesterday: load(yesterday),
      history: daysBefore(yesterday, 28).map(load).filter((l): l is DayLoad => l !== null),
    },
  });
}
