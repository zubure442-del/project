import { STEPS_DEFAULT_NORM, relayView, settleRelay, type RelayDay, type RelayView } from '../domain';
import type { DaySnapshot, VueloState } from '../storage';
import { findDay, todayKey } from './day';

/** Шаги дня после шумоподавления и его норма (у старых сводок без нормы — 10 000). */
export const relayDay = (date: string, day: DaySnapshot | null): RelayDay => ({
  date,
  steps: day?.steps ?? null,
  norm: day?.stepNorm?.value ?? STEPS_DEFAULT_NORM,
});

/**
 * Проверка кэша при открытии приложения и после выгрузки: орехи за прошедшие дни с нормой,
 * серия и ступени лестницы. Ничего не начислено — то же состояние (без лишней записи).
 */
export function settleRelayState(state: VueloState, now = new Date()): VueloState {
  const relay = settleRelay(state.relay, state.days.map((d) => relayDay(d.date, d)), todayKey(now));
  return relay === state.relay ? state : { ...state, relay };
}

/** Карточка «Эстафета» за сегодня: остаток до нормы или «Зелёный свет», огонёк и лестница. */
export const relayFor = (state: VueloState, now = new Date()): RelayView => {
  const today = todayKey(now);
  return relayView(state.relay, relayDay(today, findDay(state.days, today)), today);
};
