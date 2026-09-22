import { generateDemoRaw } from '../demo/generate';
import type { VueloState } from '../storage';
import { EMPTY_RELAY } from '../domain';
import { settleRelayState } from './relay';
import { rebuildDays } from './sync-plan';

/** Статус в шапке, пока включён демо-режим: чтобы демо не приняли за данные кольца. */
export const DEMO_STATUS_TEXT = 'Демо-режим';

/**
 * Что показывают экраны в демо-режиме. Генератор даёт только второстепенные показатели
 * (ряды сна, шагов, пульса, 0x55, кислорода), а Сон, Активность, Организм и итог считает
 * тот же `rebuildDays`, что и после выгрузки кольца. Профиль — настоящий.
 * Реальное состояние не меняется; результат помечен `demo: true`, и `saveState` его не пишет.
 */
export function demoState(real: VueloState, seed: number, now = new Date()): VueloState {
  const rebuilt = rebuildDays(
    {
      ...real,
      demo: true,
      raw: generateDemoRaw(seed, now),
      // Своё у демо: нормы, советы, отметки выгрузки и орехи не берём из реальной истории и не пишем в неё.
      stepNorms: {},
      reports: [],
      syncedAt: {},
      syncFailed: false,
      // «Эстафета» у демо своя: орехи и серия по демо-неделе, настоящий баланс не трогается.
      relay: EMPTY_RELAY,
    },
    now,
  );
  return settleRelayState(rebuilt, now);
}
