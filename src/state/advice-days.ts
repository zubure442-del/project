import { adviceDay, glucoseLevel, type AdviceDay } from '../domain';
import type { VueloState } from '../storage';
import { findDay, todayKey } from './day';

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Сколько прошлых дней кладём в таблицу: неделя — видно и «обычно», и то, что копится. */
export const ADVICE_DAYS_BACK = 7;

/** Шаги сегодня по часам: с часа подъёма (не раньше 7:00) до часа данных. */
export interface AdviceHours {
  from: number;
  steps: number[];
}

/**
 * Таблица чисел для «Мнения Лиса»: строка на каждый из семи прошлых дней, где есть данные,
 * и сегодняшний день до времени последней выгрузки, плюс шаги сегодня по часам. Без выводов:
 * что за числами стоит, решает модель.
 */
export function adviceDaysFor(state: VueloState, now = new Date()): { days: AdviceDay[]; hours: AdviceHours | null } {
  const today = todayKey(now);
  const synced = state.lastSyncAt === null ? null : new Date(state.lastSyncAt);
  const upTo = synced && todayKey(synced) === today ? synced.getHours() * 60 + synced.getMinutes() : null;
  const dated = Array.from({ length: ADVICE_DAYS_BACK + 1 }, (_, i) => {
    const ago = ADVICE_DAYS_BACK - i;
    return { ago, day: findDay(state.days, shiftDate(today, -ago)) };
  }).filter((d): d is { ago: number; day: NonNullable<typeof d.day> } => d.day !== null);

  // Обычный уровень глюкозы — по всем замерам таблицы: от него считаются подъёмы после еды.
  const level = glucoseLevel(
    dated.flatMap(({ day }) => day.summaryPoints.map((p) => p.glucose).filter((v): v is number => v !== null)),
  );
  const days = dated.map(({ ago, day }) => adviceDay(ago, day, level, ago === 0 ? upTo : null));

  const todayDay = dated.find((d) => d.ago === 0)?.day ?? null;
  let hours: AdviceHours | null = null;
  if (todayDay && upTo !== null) {
    const wake = todayDay.sleepSegments.length ? Math.max(...todayDay.sleepSegments.map((s) => s.to)) : 7 * 60;
    const from = Math.floor(Math.max(wake, 7 * 60) / 60);
    const to = Math.floor(upTo / 60);
    if (to >= from) hours = { from, steps: todayDay.stepsByHour.slice(from, to + 1) };
  }
  return { days, hours };
}
