import { nowRingTs } from '../codec';
import type { CycleSnapshot, VueloState } from '../storage';

/** Текущий цикл бодрствования: последний, который ещё идёт. Кольцо снято — текущего нет. */
export function currentCycle(state: Pick<VueloState, 'cycles' | 'ringOffSince'>): CycleSnapshot | null {
  if (state.ringOffSince !== null) return null;
  const last = state.cycles[state.cycles.length - 1];
  return last && last.end === null ? last : null;
}

/**
 * Почему у текущего цикла нет итога:
 * - calibration — сна ещё не было (новый пользователь) или данных не хватило;
 * - offBody — кольцо было снято дольше 3 часов: сна и организма за пропуск нет;
 * - ringOff — кольцо снято сейчас;
 * - timeout — больше 28 часов без сна.
 */
export type TodayHidden = 'calibration' | 'offBody' | 'ringOff' | 'timeout';

export interface TodayAnalytics {
  cycle: CycleSnapshot | null;
  /** null — итог есть, показываем как обычно. */
  hidden: TodayHidden | null;
  /** Время без кольца (кольцевые метки); `to: null` — кольца нет до сих пор. */
  gap: { from: number; to: number | null } | null;
}

/** Что показывает «Сегодня»: аналитика текущего цикла, а не календарных суток. */
export function todayAnalytics(state: Pick<VueloState, 'cycles' | 'ringOffSince'>): TodayAnalytics {
  if (state.ringOffSince !== null) return { cycle: null, hidden: 'ringOff', gap: { from: state.ringOffSince, to: null } };
  const cycle = currentCycle(state);
  if (!cycle) return { cycle: null, hidden: 'calibration', gap: null };
  if (cycle.total !== null) return { cycle, hidden: null, gap: null };
  if (cycle.startedBy === 'offBody') return { cycle, hidden: 'offBody', gap: cycle.before };
  if (cycle.startedBy === 'timeout') return { cycle, hidden: 'timeout', gap: null };
  return { cycle, hidden: 'calibration', gap: null };
}

/**
 * Открываются ли Сон, Активность и Организм. Сегодня — если есть что показать по циклу:
 * итог, или хотя бы активность после снятого кольца или таймаута (исключение ради пользы).
 * Прошлый день — если за него есть хоть какие-то данные: на прошлых датах только графики и счётчики.
 */
export function tabsOpenFor(state: VueloState, date: string, today: string, hasData: boolean): boolean {
  if (date !== today) return hasData;
  return todayAnalytics(state).hidden !== 'calibration';
}

/** Полночь даты как кольцевая метка. */
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

/**
 * Опора рекомендаций текущего цикла: дата его начала и «сейчас» в минутах от её полуночи.
 * После полуночи минут больше 1440 — цикл продолжается, карточки не обрываются.
 * Нет цикла со сном и оценкой сна — null: рекомендаций нет.
 */
export function cycleClock(
  state: Pick<VueloState, 'cycles' | 'ringOffSince'>,
  now = new Date(),
): { cycle: CycleSnapshot; date: string; nowMinute: number; sleepScore: number } | null {
  const cycle = currentCycle(state);
  const sleepScore = cycle?.scores.sleep ?? null;
  if (!cycle || !cycle.sleep || sleepScore === null || !cycle.sleepSegments.length) return null;
  const nowTs = nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60);
  return { cycle, date: cycle.date, nowMinute: Math.floor((nowTs - midnight(cycle.date)) / 60), sleepScore };
}
