import {
  PERSONAL_BASELINE_DAYS,
  averageBedtime,
  endurancePeak,
  enduranceLevel,
  foodCycle,
  workoutType,
  type EnduranceInput,
  type EnduranceLevel,
  type EnduranceResult,
  type WorkoutType,
} from '../domain';
import type { CycleSnapshot, DaySnapshot, VueloState } from '../storage';
import { cycleClock } from './cycle';
import { coffeeInput, findDay } from './day';
import { foodInput } from './food';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Замеры 0x55 нескольких дней как кольцевые метки. */
function summaryAt(days: readonly DaySnapshot[], dates: readonly string[]) {
  return dates.flatMap((date) =>
    (findDay([...days], date)?.summaryPoints ?? []).map((p) => ({ ...p, ts: midnight(date) + p.m * 60 })),
  );
}

/** Кислород нескольких дней как кольцевые метки. */
function spo2At(days: readonly DaySnapshot[], dates: readonly string[]) {
  return dates.flatMap((date) => (findDay([...days], date)?.spo2 ?? []).map((p) => ({ ts: midnight(date) + p.m * 60, v: p.v })));
}

/** Средняя вариабельность за сон цикла. */
function nightHrvOf(days: readonly DaySnapshot[], cycle: CycleSnapshot): number | null {
  if (!cycle.sleep) return null;
  const { start, end } = cycle.sleep;
  const dates = [shiftDate(cycle.date, -1), cycle.date];
  return mean(
    summaryAt(days, dates)
      .filter((p) => p.ts >= start && p.ts <= end && p.hrv !== null)
      .map((p) => p.hrv as number),
  );
}

/** Главный сон каждого из семи прошлых дней (самый длинный): из них — свои нормы. */
function previousNights(cycles: readonly CycleSnapshot[], date: string): CycleSnapshot[] {
  const byDate = new Map<string, CycleSnapshot>();
  for (const c of cycles) {
    if (!c.sleep || c.date >= date || c.date < shiftDate(date, -PERSONAL_BASELINE_DAYS)) continue;
    const known = byDate.get(c.date);
    if (!known || (known.sleep && c.sleep.totalMin > known.sleep.totalMin)) byDate.set(c.date, c);
  }
  return [...byDate.values()];
}

/**
 * Прогноз стресса по часам суток. Стресс бывает только после пробуждения: ночью кольцо пишет
 * 0–10, и такие замеры прогноз занижали бы, поэтому замеры внутри сна не берём.
 * Прогноз — среднее бодрствующих замеров этого часа за семь прошлых дней и сегодня.
 */
function stressForecast(days: readonly DaySnapshot[], date: string): (number | null)[] {
  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  for (let i = PERSONAL_BASELINE_DAYS; i >= 0; i--) {
    const day = findDay([...days], shiftDate(date, -i));
    if (!day) continue;
    const asleep = (m: number) => day.sleepSegments.some((s) => m >= s.from && m <= s.to);
    for (const p of day.stress) if (!asleep(p.m)) buckets[Math.floor(p.m / 60) % 24].push(p.v);
  }
  return buckets.map((values) => mean(values));
}

export type EnduranceView = EnduranceResult & {
  nowMinute: number;
  /** Какую тренировку выбрать — по цели профиля. */
  workout: WorkoutType;
  /** Насколько интенсивно — «Хард», «Средне», «Лайт». */
  level: EnduranceLevel;
};

/**
 * «Пик выносливости» текущего цикла. Нет цикла со сном — null: карточки нет, как у «Кофейного окна».
 * Своя норма (глубокий и лёгкий сон, вариабельность, ночной пульс) — среднее по прошлым ночам
 * за семь дней; хватает и одной ночи. Нет ни одной — этот шаг пропускается.
 */
export function enduranceFor(state: VueloState, now = new Date()): EnduranceView | null {
  const clock = cycleClock(state, now);
  const coffee = coffeeInput(state, now);
  if (!clock || !coffee || !clock.cycle.sleep) return null;
  const { cycle, date, nowMinute } = clock;
  const sleep = clock.cycle.sleep;
  const toMinute = (ts: number) => (ts - midnight(date)) / 60;
  const nights = previousNights(state.cycles, date);
  const dates = [shiftDate(date, -1), date, shiftDate(date, 1)];
  const summary = summaryAt(state.days, dates);
  const nowTs = midnight(date) + nowMinute * 60;
  const meals = foodInput(state, now);

  const input: EnduranceInput = {
    wakeMinute: toMinute(sleep.end),
    bedtimeMinute: averageBedtime(coffee.bedtimes),
    deepMin: sleep.deepMin,
    lightMin: sleep.lightMin,
    deepNorm: mean(nights.map((c) => c.sleep!.deepMin)),
    lightNorm: mean(nights.map((c) => c.sleep!.lightMin)),
    nightHrv: nightHrvOf(state.days, cycle),
    hrvNorm: mean(nights.map((c) => nightHrvOf(state.days, c)).filter((v): v is number => v !== null)),
    nightPulse: cycle.nightHr?.avg ?? null,
    pulseNorm: mean(nights.map((c) => c.nightHr?.avg).filter((v): v is number => v !== undefined)),
    nightSpo2: spo2At(state.days, dates)
      .filter((p) => p.ts >= sleep.start && p.ts <= sleep.end)
      .map((p) => ({ m: toMinute(p.ts), v: p.v })),
    dayPressure: summary
      .filter((p) => p.ts >= cycle.start && p.ts <= nowTs && p.systolic !== null && p.diastolic !== null)
      .map((p) => ({ m: toMinute(p.ts), systolic: p.systolic as number, diastolic: p.diastolic as number })),
    glucose: summary
      .filter((p) => p.ts >= sleep.start && p.ts <= nowTs && p.glucose !== null)
      .map((p) => ({ m: toMinute(p.ts), v: p.glucose as number })),
    stressByHour: stressForecast(state.days, date),
    meals: meals ? foodCycle(meals).meals : [],
  };
  const peak = endurancePeak(input);
  return {
    ...peak,
    nowMinute,
    workout: workoutType(peak.kind, state.profile.goal, date),
    level: enduranceLevel(peak.intensity),
  };
}
