import { adviceDay, findInsight, glucoseLevel, type AdviceDay, type Insight, type MinutePoint, type ReportMode } from '../domain';
import { profileAge, type DaySnapshot, type VueloState } from '../storage';
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
    said,
  });
}
