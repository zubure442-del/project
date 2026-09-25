import { dayFacts, type DayLoad, type MinutePoint } from '../domain';
import type { DaySnapshot, VueloState } from '../storage';
import { currentCycle } from './cycle';
import { findDay, todayKey } from './day';
import { sleepHrFor } from './sleep-hr';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
/** Прошлые дни: `count` календарных дней до `date`, самый старый первым. */
const daysBefore = (date: string, count: number) => Array.from({ length: count }, (_, i) => shiftDate(date, -(count - i)));
const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const known = <T,>(values: readonly (T | null | undefined)[]) => values.filter((v): v is T => v !== null && v !== undefined);

const glucoseOf = (day: DaySnapshot | null): MinutePoint[] =>
  (day?.summaryPoints ?? []).filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));
const spo2Of = (day: DaySnapshot | null) => mean((day?.spo2 ?? []).map((p) => p.v));

/**
 * Факты дня для «Мнения Лиса» (`dayFacts`): сегодня против своей нормы за прошлую неделю — сон,
 * пульс во сне, вариабельность, пульс покоя, кислород, вчерашний день, шаги по часам, стресс,
 * подъёмы глюкозы. Без выводов: что за этим стоит, решает модель. «Сегодня» — до времени последней
 * выгрузки: новых замеров после неё ещё нет.
 */
export function factsFor(state: VueloState, now = new Date()): string[] {
  const today = todayKey(now);
  const week = daysBefore(today, 7);
  const day = (date: string) => findDay(state.days, date);
  const todayDay = day(today);
  const yesterday = shiftDate(today, -1);
  const yesterdayDay = day(yesterday);
  const synced = state.lastSyncAt === null ? null : new Date(state.lastSyncAt);
  const dataMinute = synced && todayKey(synced) === today ? synced.getHours() * 60 + synced.getMinutes() : null;

  // Сон: текущий цикл и главный (самый длинный) сон каждого из семи прошлых дней.
  const cycle = currentCycle(state);
  const rel = (ts: number, date: string) => Math.round((ts - midnight(date)) / 60);
  const nights = new Map<string, { asleep: number; awake: number; totalMin: number; deepMin: number }>();
  for (const c of state.cycles) {
    if (!c.sleep || c === cycle || !week.includes(c.date)) continue;
    const seen = nights.get(c.date);
    if (!seen || c.sleep.totalMin > seen.totalMin) {
      nights.set(c.date, {
        asleep: rel(c.sleep.start, c.date),
        awake: rel(c.sleep.end, c.date),
        totalMin: c.sleep.totalMin,
        deepMin: c.sleep.deepMin,
      });
    }
  }
  const sleep = cycle?.sleep ?? null;
  const sleepHr = sleepHrFor(state, today, now);
  const load = (date: string): DayLoad | null => state.training[date] ?? null;

  return dayFacts({
    dataMinute,
    sleep: {
      asleep: sleep && cycle ? rel(sleep.start, cycle.date) : null,
      awake: sleep && cycle ? rel(sleep.end, cycle.date) : null,
      totalMin: sleep?.totalMin ?? null,
      deepMin: sleep?.deepMin ?? null,
      history: [...nights.values()],
    },
    nightPulse: sleepHr ? { min: sleepHr.night.min, avg: sleepHr.night.avg, norm: sleepHr.baseline } : null,
    hrv: { today: todayDay?.estimates.hrv ?? null, history: known(week.map((d) => day(d)?.estimates.hrv)) },
    restingPulse: { today: todayDay?.restingHr ?? null, history: known(week.map((d) => day(d)?.restingHr)) },
    spo2: { today: spo2Of(todayDay), history: known(week.map((d) => spo2Of(day(d)))) },
    steps: {
      today: todayDay?.stepsByMinute ?? [],
      history: week.map((d) => day(d)?.stepsByMinute ?? []),
      wake: sleep && cycle && cycle.date === today ? rel(sleep.end, today) : null,
    },
    stress: { today: todayDay?.stress ?? [], history: week.map((d) => day(d)?.stress ?? []) },
    glucose: {
      today: glucoseOf(todayDay),
      yesterday: glucoseOf(yesterdayDay),
      history: week.map((d) => glucoseOf(day(d))),
    },
    yesterday: {
      steps: yesterdayDay?.steps ?? null,
      norm: yesterdayDay?.stepNorm?.value ?? null,
      load: load(yesterday),
      history: known(daysBefore(yesterday, 28).map(load)),
    },
  });
}
