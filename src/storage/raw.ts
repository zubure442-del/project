import { dateKey, wallClock, type HeartSample, type Sample, type SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import { HISTORY_DAYS } from './types';

/**
 * Сырые ряды за день. Храним их целиком, а не только итоговые числа:
 * частичная синхронизация не должна стирать графики за то, что не успело прийти.
 * Минуты отсчитываются от полуночи этого дня; у сна они бывают отрицательными
 * (вечер накануне), поэтому день хранит свою ночь полностью.
 */
export interface DayRaw {
  date: string;
  /** [минута, шаги] — нулевые минуты не храним. */
  steps: [number, number][];
  /** [минута, состояние сна]. */
  sleep: [number, number][];
  /** [минута, пульс]. */
  heart: [number, number][];
  /** [минута, сист., диаст., стресс, глюкоза×10, HRV]; −1 — значения нет. */
  summary: [number, number, number, number, number, number][];
}

export type RawByDay = Record<string, DayRaw>;

const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
const minuteOf = (ts: number) => {
  const w = wallClock(ts);
  return w.hour * 60 + w.minute;
};
const NONE = -1;
const emptyDay = (date: string): DayRaw => ({ date, steps: [], sleep: [], heart: [], summary: [] });

/** Раскладывает выгрузку по дням. Ночь целиком относится ко дню пробуждения. */
export function splitByDay(sync: SyncResult): RawByDay {
  const out: RawByDay = {};
  const day = (date: string) => (out[date] ??= emptyDay(date));

  for (const s of sync.steps) {
    if (s.value > 0) day(dateKey(s.ts)).steps.push([minuteOf(s.ts), s.value]);
  }
  for (const s of sync.heart) day(dateKey(s.ts)).heart.push([minuteOf(s.ts), s.value]);
  for (const r of sync.summary) {
    day(dateKey(r.ts)).summary.push([
      minuteOf(r.ts),
      r.systolic ?? NONE,
      r.diastolic ?? NONE,
      r.stress ?? NONE,
      r.glucose === null ? NONE : Math.round(r.glucose * 10),
      r.hrv ?? NONE,
    ]);
  }
  // Сон: минуты до полуночи приписываем следующему дню отрицательной минутой,
  // чтобы ночь не разрывалась между двумя записями кэша.
  for (const s of sync.sleep) {
    const w = wallClock(s.ts);
    const minute = w.hour * 60 + w.minute;
    const evening = minute >= 12 * 60;
    const date = evening ? dateKey(s.ts + 86400) : dateKey(s.ts);
    day(date).sleep.push([evening ? minute - 1440 : minute, s.value]);
  }
  return out;
}

/** Новые ряды поверх старых: по дню и по типу, и только если новое непусто. */
export function mergeRaw(previous: RawByDay, incoming: RawByDay): RawByDay {
  const out: RawByDay = { ...previous };
  for (const [date, fresh] of Object.entries(incoming)) {
    const old = out[date] ?? emptyDay(date);
    out[date] = {
      date,
      steps: fresh.steps.length ? fresh.steps : old.steps,
      sleep: fresh.sleep.length ? fresh.sleep : old.sleep,
      heart: fresh.heart.length ? fresh.heart : old.heart,
      summary: fresh.summary.length ? fresh.summary : old.summary,
    };
  }
  return keepRecentDays(out);
}

export function keepRecentDays(raw: RawByDay): RawByDay {
  const dates = Object.keys(raw).sort().slice(-HISTORY_DAYS);
  return Object.fromEntries(dates.map((d) => [d, raw[d]]));
}

/** Обратно в вид выгрузки, чтобы пересчитать сводки теми же функциями. */
export function toSyncResult(raw: RawByDay, battery: number | null = null): SyncResult {
  const steps: Sample[] = [];
  const sleep: Sample[] = [];
  const heart: HeartSample[] = [];
  const summary: SummaryRecord[] = [];

  for (const day of Object.values(raw)) {
    const base = midnight(day.date);
    for (const [m, v] of day.steps) steps.push({ ts: base + m * 60, value: v });
    for (const [m, v] of day.sleep) sleep.push({ ts: base + m * 60, value: v });
    for (const [m, v] of day.heart) heart.push({ ts: base + m * 60, value: v, raw: [v] });
    for (const [m, sys, dia, stress, glucose, hrv] of day.summary) {
      summary.push({
        ts: base + m * 60,
        systolic: sys === NONE ? null : sys,
        diastolic: dia === NONE ? null : dia,
        stress: stress === NONE ? null : stress,
        glucose: glucose === NONE ? null : glucose / 10,
        hrv: hrv === NONE ? null : hrv,
      });
    }
  }
  const byTs = <T extends { ts: number }>(x: T[]) => x.sort((a, b) => a.ts - b.ts);
  return {
    steps: byTs(steps),
    sleep: byTs(sleep),
    heart: byTs(heart),
    spo2: [],
    summary: byTs(summary),
    activity: null,
    battery,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
  };
}
