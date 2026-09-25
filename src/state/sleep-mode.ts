import { averageBedtime, sleepMode, type SleepMode, type SleepNight } from '../domain';
import { SNAPSHOT_DAYS, type CycleSnapshot, type VueloState } from '../storage';
import { cycleClock } from './cycle';
import { coffeeInput } from './day';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Минута суток по кольцевой метке. */
const minuteOfDay = (ts: number) => (((Math.floor(ts / 60) % 1440) + 1440) % 1440);

const nightOf = (c: CycleSnapshot): SleepNight | null =>
  c.sleep
    ? {
        sleptMin: c.sleep.totalMin,
        spanMin: Math.round((c.sleep.end - c.sleep.start) / 60) + 1,
        score: c.scores.sleep,
        wakeMinute: minuteOfDay(c.sleep.end),
      }
    : null;

/**
 * «Режим сна» текущего цикла. Нет цикла со сном — null: карточки нет, как у «Кофейного окна».
 * Ночи — главный сон (самый длинный) каждого из двух прошлых недель дня и сон текущего цикла последним.
 */
export function sleepModeFor(state: VueloState, now = new Date()): SleepMode | null {
  const clock = cycleClock(state, now);
  const coffee = coffeeInput(state, now);
  if (!clock || !coffee) return null;
  const { cycle, date, nowMinute } = clock;

  const byDate = new Map<string, CycleSnapshot>();
  for (const c of state.cycles) {
    if (c === cycle || !c.sleep || c.date >= date || c.date < shiftDate(date, -SNAPSHOT_DAYS)) continue;
    const known = byDate.get(c.date);
    if (!known?.sleep || c.sleep.totalMin > known.sleep.totalMin) byDate.set(c.date, c);
  }
  const nights = [...[...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), cycle]
    .map(nightOf)
    .filter((n): n is SleepNight => n !== null);

  return sleepMode({
    nights,
    usualBedtime: averageBedtime(coffee.bedtimes),
    activity: cycle.scores.activity,
    nowMinute,
  });
}
