import {
  adviceDay,
  findInsight,
  glucoseLevel,
  organismParts,
  organismSamples,
  personalBaseline,
  type AdviceDay,
  type ComponentId,
  type Insight,
  type MinutePoint,
  type OrganismParts,
  type ReportMode,
  type ScoreFact,
} from '../domain';
import { profileAge, type DaySnapshot, type VueloState } from '../storage';
import { currentCycle } from './cycle';
import { findDay, recommendationsFor, todayKey } from './day';
import { notMealOf } from './food';
import { sleepModeFor } from './sleep-mode';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Сколько прошлых дней берём для личных норм движка физиологии: неделя. */
export const ADVICE_DAYS_BACK = 7;

/**
 * Строки по дням для движка физиологии: каждый из семи прошлых дней, где есть данные, и сегодняшний
 * день до времени последней выгрузки. `upTo` — минута последней выгрузки сегодня; выгрузки сегодня
 * не было — null (о «сейчас» судить не по чему).
 */
export function adviceDaysFor(state: VueloState, now = new Date()): { days: AdviceDay[]; upTo: number | null } {
  const today = todayKey(now);
  const synced = state.lastSyncAt === null ? null : new Date(state.lastSyncAt);
  const upTo = synced && todayKey(synced) === today ? synced.getHours() * 60 + synced.getMinutes() : null;
  const dated = Array.from({ length: ADVICE_DAYS_BACK + 1 }, (_, i) => {
    const ago = ADVICE_DAYS_BACK - i;
    return { ago, day: findDay(state.days, shiftDate(today, -ago)) };
  }).filter((d): d is { ago: number; day: NonNullable<typeof d.day> } => d.day !== null);

  // Обычный уровень глюкозы — по всем замерам недели: от него считаются подъёмы после еды.
  const level = glucoseLevel(
    dated.flatMap(({ day }) => day.summaryPoints.map((p) => p.glucose).filter((v): v is number => v !== null)),
  );
  // Подъёмы во сне и на интенсивной нагрузке — не еда: рассветный подъём не примем за ночной перекус.
  const age = profileAge(state.profile, now) ?? state.age;
  const days = dated.map(({ ago, day }) => adviceDay(ago, day, level, ago === 0 ? upTo : null, notMealOf(day, age)));
  return { days, upTo };
}

/** Ряды вчера и сегодня на одной оси: минуты от полуночи сегодня, вчерашние — отрицательные. */
function joined(yesterday: DaySnapshot | null, today: DaySnapshot | null, pick: (d: DaySnapshot) => readonly MinutePoint[], upTo: number) {
  return [
    ...(yesterday ? pick(yesterday).map((p) => ({ m: p.m - 1440, v: p.v })) : []),
    ...(today ? pick(today).filter((p) => p.m <= upTo) : []),
  ];
}

/** Ряд из записей 0x55 (выбросы глюкозы уже убраны при сборке дня). */
const series = (d: DaySnapshot, key: 'systolic' | 'glucose'): MinutePoint[] =>
  d.summaryPoints.flatMap((p) => (p[key] === null ? [] : [{ m: p.m, v: p[key] as number }]));

/** Норма оценки — по стольким прошлым циклам недели, не меньше. */
export const SCORE_NORM_MIN_CYCLES = 2;

/**
 * Оценка текущего цикла против своей нормы — среднего завершённых циклов за 7 дней до сегодня.
 * Так же считает шапка вкладки, пока второй недели нет («ниже вашей нормы»).
 */
export function scoreFact(state: Pick<VueloState, 'cycles' | 'ringOffSince'>, metric: ComponentId, now = new Date()): ScoreFact | null {
  const cycle = currentCycle(state);
  const value = cycle?.scores[metric] ?? null;
  if (value === null) return null;
  const from = shiftDate(todayKey(now), -ADVICE_DAYS_BACK);
  const past = state.cycles
    .filter((c) => c.end !== null && c.date >= from && c.date < todayKey(now))
    .map((c) => c.scores[metric])
    .filter((v): v is number => v !== null);
  if (past.length < SCORE_NORM_MIN_CYCLES) return null;
  return { value, norm: past.reduce((a, b) => a + b, 0) / past.length };
}

/**
 * Подоценки «Организма» сегодня (до выгрузки) и обычно — за 7 прошлых дней, тем же расчётом, что и
 * сама оценка: по ним видно, что тянет Организм вниз или вверх.
 */
export function organismPartsFor(state: VueloState, upTo: number, now = new Date()): OrganismParts {
  const today = todayKey(now);
  const samplesOf = (d: DaySnapshot, until = 1440) =>
    organismSamples(d.summaryPoints.filter((p) => p.m <= until), d.heart.filter((p) => p.m <= until), d.spo2.filter((p) => p.m <= until));
  const past = Array.from({ length: ADVICE_DAYS_BACK }, (_, i) => findDay(state.days, shiftDate(today, -(ADVICE_DAYS_BACK - i))))
    .filter((d): d is DaySnapshot => d !== null);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const baseline = personalBaseline(
    past.map((d) => ({
      hrv: mean(d.summaryPoints.map((p) => p.hrv).filter((v): v is number => v !== null)),
      pulse: d.heart.length ? Math.min(...d.heart.map((p) => p.v)) : null,
    })),
  );
  const day = findDay(state.days, today);
  return day ? organismParts(samplesOf(day, upTo), past.map((d) => samplesOf(d)), baseline) : {};
}

/**
 * Вывод движка физиологии для «Мнения Лиса» (`findInsight`): что с телом сейчас и почему. `said` —
 * о каких связках Лис уже говорил (за цикл и за неделю): движок выберет другую. null — сказать
 * нечего (не было выгрузки сегодня или нет замеров за последний час).
 */
export function insightFor(
  state: VueloState,
  mode: ReportMode,
  said: { today: readonly string[]; week: readonly string[] },
  now = new Date(),
): Insight | null {
  const { days, upTo } = adviceDaysFor(state, now);
  if (upTo === null) return null;
  const today = findDay(state.days, todayKey(now));
  const yesterday = findDay(state.days, shiftDate(todayKey(now), -1));
  // План Vuelo на сегодня — ориентир и для прошлой ночи: окно сна и ужин от дня к дню почти не меняются.
  const sleepMode = sleepModeFor(state, now);
  const meals = recommendationsFor(state, todayKey(now), now)?.food?.meals ?? [];
  const dinner = meals.length ? Math.max(...meals.map((m) => m.minute)) : null;
  return findInsight({
    mode,
    now: upTo,
    days,
    heart: joined(yesterday, today, (d) => d.heart, upTo),
    steps: joined(yesterday, today, (d) => d.stepsByMinute, upTo),
    stress: joined(yesterday, today, (d) => d.stress, upTo),
    systolic: joined(yesterday, today, (d) => series(d, 'systolic'), upTo),
    glucose: joined(yesterday, today, (d) => series(d, 'glucose'), upTo),
    sleepDebtMin: sleepMode?.debtMin ?? null,
    plan: { bedTo: sleepMode?.to ?? null, dinner },
    scores: { sleep: scoreFact(state, 'sleep', now), state: scoreFact(state, 'state', now) },
    organismParts: organismPartsFor(state, upTo, now),
    said,
  });
}
