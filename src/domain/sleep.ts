import { dateKey } from '../codec/time';
import type { Sample } from '../codec/types';

export const SLEEP_SESSION_GAP = 7200;
export const DEEP_MIN_STATE = 80;

export interface SleepSession {
  start: number;
  end: number;
  deepMin: number;
  lightMin: number;
  awakeMin: number;
  /** Дата ПОСЛЕДНЕЙ минуты сессии — чтобы ночь не резалась полуночью. */
  date: string;
}

export const sleepMinutes = (s: Pick<SleepSession, 'deepMin' | 'lightMin'>) => s.deepMin + s.lightMin;

/** Сессии сна из минутных состояний 0x11: разрыв больше 2 часов начинает новую. Сессии без сна отбрасываются. */
export function buildSleepSessions(samples: Sample[]): SleepSession[] {
  const items = [...samples].sort((a, b) => a.ts - b.ts);
  const sessions: SleepSession[] = [];
  let cur: SleepSession | null = null;
  let last = 0;
  for (const { ts, value } of items) {
    if (cur && ts - last > SLEEP_SESSION_GAP) {
      sessions.push(cur);
      cur = null;
    }
    cur ??= { start: ts, end: ts, deepMin: 0, lightMin: 0, awakeMin: 0, date: '' };
    if (value >= DEEP_MIN_STATE) cur.deepMin++;
    else if (value >= 1) cur.lightMin++;
    else cur.awakeMin++;
    cur.end = ts;
    cur.date = dateKey(ts);
    last = ts;
  }
  if (cur) sessions.push(cur);
  return sessions.filter((s) => sleepMinutes(s) > 0);
}

/** Ночь = самая длинная сессия, закончившаяся в этот день; остальные — короткий дневной сон. */
export function nightForDate(sessions: SleepSession[], date: string) {
  const ofDay = sessions.filter((s) => s.date === date);
  if (!ofDay.length) return { night: null, naps: [] as SleepSession[] };
  const night = ofDay.reduce((a, b) => (sleepMinutes(b) > sleepMinutes(a) ? b : a));
  return { night, naps: ofDay.filter((s) => s !== night) };
}
