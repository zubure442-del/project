import type { VueloState } from '../storage';
import { isFresh } from './day';

/**
 * Фоновое обновление (владелец 26.09: «чтобы при открытии всё было свежим»). iOS сама будит
 * приложение, обычно незадолго до того, как человек его открывает, и даёт около 30 секунд:
 * успеваем подключиться к кольцу, забрать сегодняшний день и спросить мнение Лиса.
 * Здесь — только решение, идти ли к кольцу; сама выгрузка — `background-sync.ts`.
 */

/** Вся фоновая работа укладывается сюда: у iOS на фоновое обновление около 30 с. */
export const BACKGROUND_BUDGET_MS = 25000;
/** Подключение в фоне — не дольше: поиск в эфире в фоне iOS не даёт, только известное кольцо. */
export const BACKGROUND_CONNECT_MS = 8000;
/** Мнение Лиса просим, только если на него осталось столько времени. */
export const BACKGROUND_ADVICE_MIN_MS = 6000;
/** Реже этого iOS фоновое обновление не просим (решает всё равно она). */
export const BACKGROUND_MIN_INTERVAL_S = 30 * 60;

/**
 * Тихие часы — свой обычный сон: средние засыпание и подъём по ночам в кэше (от трёх ночей),
 * иначе 23:00–07:00. Ночью кольцо сон не отдаёт, а подключаться к нему во сне незачем
 * (запись сна подключение не прерывает: ночные сессии 21.09 00:49 и 01:37 ночь не испортили).
 */
export const QUIET_DEFAULT = { from: 23 * 60, to: 7 * 60 };
export const QUIET_MIN_NIGHTS = 3;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Тихие часы по своим ночам: минуты суток «с» и «до» (через полночь — from > to). */
export function quietHours(state: Pick<VueloState, 'days'>): { from: number; to: number } {
  const nights = state.days.filter((d) => d.sleepSegments.length > 0).slice(-7);
  if (nights.length < QUIET_MIN_NIGHTS) return QUIET_DEFAULT;
  // Минуты сна — от полуночи дня пробуждения: вечерние отрицательные.
  const asleep = mean(nights.map((d) => d.sleepSegments[0].from));
  const awake = mean(nights.map((d) => d.sleepSegments[d.sleepSegments.length - 1].to));
  const clock = (m: number) => ((Math.round(m) % 1440) + 1440) % 1440;
  return { from: clock(asleep), to: clock(awake) };
}

export function inQuietHours(state: Pick<VueloState, 'days'>, now = new Date()): boolean {
  const { from, to } = quietHours(state);
  const m = now.getHours() * 60 + now.getMinutes();
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

export type BackgroundSkip = 'not-started' | 'no-ring' | 'demo' | 'busy' | 'fresh' | 'quiet';

/** Почему в фоне к кольцу не идём — строкой для отладочного лога. */
export const BACKGROUND_SKIP_TEXT: Record<BackgroundSkip, string> = {
  'not-started': 'приложение ещё не настроено',
  'no-ring': 'кольцо ещё не привязано',
  demo: 'включён демо-режим',
  busy: 'уже идёт выгрузка',
  fresh: 'данные свежие',
  quiet: 'тихие часы сна',
};

/** Идти ли к кольцу в фоне; null — идти. */
export function backgroundSkip(
  state: VueloState,
  context: { busy: boolean; demo: boolean },
  now = new Date(),
): BackgroundSkip | null {
  if (!state.started) return 'not-started';
  if (!state.ring) return 'no-ring';
  if (context.demo) return 'demo';
  if (context.busy) return 'busy';
  if (isFresh(state, now.getTime())) return 'fresh';
  if (inQuietHours(state, now)) return 'quiet';
  return null;
}
