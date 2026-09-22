import { dateKey, wallClock, type HeartSample, type Sample, type SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import { CACHE_DAYS } from './types';

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
  /** [минута, кислород в процентах]. */
  spo2: [number, number][];
}

export type RawByDay = Record<string, DayRaw>;

const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
const minuteOf = (ts: number) => {
  const w = wallClock(ts);
  return w.hour * 60 + w.minute;
};
const NONE = -1;
const emptyDay = (date: string): DayRaw => ({ date, steps: [], sleep: [], heart: [], summary: [], spo2: [] });

/** Раскладывает выгрузку по дням. Ночь целиком относится ко дню пробуждения. */
export function splitByDay(sync: SyncResult): RawByDay {
  const out: RawByDay = {};
  const day = (date: string) => (out[date] ??= emptyDay(date));

  for (const s of sync.steps) {
    if (s.value > 0) day(dateKey(s.ts)).steps.push([minuteOf(s.ts), s.value]);
  }
  for (const s of sync.heart) day(dateKey(s.ts)).heart.push([minuteOf(s.ts), s.value]);
  for (const s of sync.spo2) day(dateKey(s.ts)).spo2.push([minuteOf(s.ts), s.value]);
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

/**
 * Ряд по минутам: новые точки поверх старых. Минута из нового ответа заменяет ту же минуту,
 * остальные сохранённые минуты остаются. Повтор одной минуты внутри ответа не удваивается.
 */
function unionByMinute<T extends readonly [number, ...number[]]>(old: T[], fresh: T[]): T[] {
  if (!fresh.length) return old;
  const byMinute = new Map<number, T>();
  for (const point of old) byMinute.set(point[0], point);
  for (const point of fresh) byMinute.set(point[0], point);
  return [...byMinute.values()].sort((a, b) => a[0] - b[0]);
}

/**
 * Новые ряды поверх старых: по дню и типу, объединением по минутам.
 * Раньше непустой ответ заменял ряд дня целиком, и неполный ответ кольца стирал сохранённое:
 * поток 0x55 без маркера конца (лог d, 21.09 19:53) оставлял часть замеров — «Организм» терял
 * покрытие, итог пропадал, и на «Сегодня» снова было «Считаем вашу активность». Так же терялась
 * вечерняя часть ночи (она приходит в окне вчерашнего дня) и весь пульс дня после живого замера.
 */
export function mergeRaw(previous: RawByDay, incoming: RawByDay): RawByDay {
  const out: RawByDay = { ...previous };
  for (const [date, fresh] of Object.entries(incoming)) {
    const old = out[date] ?? emptyDay(date);
    out[date] = {
      date,
      steps: unionByMinute(old.steps, fresh.steps),
      sleep: unionByMinute(old.sleep, fresh.sleep),
      heart: unionByMinute(old.heart, fresh.heart),
      summary: unionByMinute(old.summary, fresh.summary),
      spo2: unionByMinute(old.spo2, fresh.spo2),
    };
  }
  return keepRecentDays(out);
}

/** Автоочистка: держим CACHE_DAYS дней, остальное выбрасываем при запуске. */
export function keepRecentDays(raw: RawByDay, limit = CACHE_DAYS): RawByDay {
  const dates = Object.keys(raw).sort().slice(-limit);
  return Object.fromEntries(dates.map((d) => [d, raw[d]]));
}

/** Обратно в вид выгрузки, чтобы пересчитать сводки теми же функциями. */
export function toSyncResult(raw: RawByDay, battery: number | null = null): SyncResult {
  const steps: Sample[] = [];
  const sleep: Sample[] = [];
  const heart: HeartSample[] = [];
  const summary: SummaryRecord[] = [];
  const spo2: Sample[] = [];

  for (const day of Object.values(raw)) {
    const base = midnight(day.date);
    for (const [m, v] of day.steps) steps.push({ ts: base + m * 60, value: v });
    for (const [m, v] of day.sleep) sleep.push({ ts: base + m * 60, value: v });
    for (const [m, v] of day.heart) heart.push({ ts: base + m * 60, value: v, raw: [v] });
    for (const [m, v] of day.spo2) spo2.push({ ts: base + m * 60, value: v });
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
    spo2: byTs(spo2),
    summary: byTs(summary),
    activity: null,
    battery,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
    completeDays: [],
    error: null,
    capped: false,
  };
}

/**
 * Перенос старого кэша в ряды по дням.
 * До этой версии хранились только сводки дня (DaySnapshot), а рядов не было.
 * Без переноса первая же синхронизация пересобирала дни из пустых рядов и стирала сон,
 * который кольцо второй раз не отдаёт.
 *
 * Поминутные шаги из сводки восстановить нельзя, там остался только почасовой итог:
 * кладём каждый час одной записью на его начало.
 */
export function migrateSnapshots(days: unknown[]): RawByDay {
  const out: RawByDay = {};
  for (const item of days as Record<string, any>[]) {
    if (!item || typeof item.date !== 'string') continue;
    const day = emptyDay(item.date);
    for (const seg of (item.sleepSegments ?? []) as { from: number; to: number; stage: string }[]) {
      const value = seg.stage === 'deep' ? 99 : seg.stage === 'light' ? 40 : 0;
      for (let m = Math.round(seg.from); m < Math.round(seg.to); m++) day.sleep.push([m, value]);
    }
    for (const p of (item.heart ?? []) as { m: number; v: number }[]) day.heart.push([p.m, p.v]);
    for (const p of (item.spo2 ?? []) as { m: number; v: number }[]) day.spo2.push([p.m, p.v]);
    for (const p of (item.summaryPoints ?? []) as Record<string, number | null>[]) {
      day.summary.push([
        p.m as number,
        p.systolic ?? NONE,
        p.diastolic ?? NONE,
        NONE,
        p.glucose === null || p.glucose === undefined ? NONE : Math.round(p.glucose * 10),
        p.hrv ?? NONE,
      ]);
    }
    (item.stepsByHour ?? []).forEach((value: number, hour: number) => {
      if (value > 0) day.steps.push([hour * 60, value]);
    });
    if (day.sleep.length || day.heart.length || day.summary.length || day.steps.length || day.spo2.length) {
      out[item.date] = day;
    }
  }
  return out;
}
