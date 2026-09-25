import { RingBle, type KnownRing, type RingProfile } from '../ble';
import { isProfileComplete, profileAge, type Profile, type VueloState } from '../storage';

/**
 * Одно кольцо и один замок выгрузки на всё приложение: их делят экран (провайдер) и фоновое
 * обновление (`background-sync.ts`). Два BleManager с одним идентификатором восстановления iOS
 * путает, а две выгрузки сразу кольцо не переварит (новый запрос того же кода обрывает старый поток).
 */
export const ringSession = {
  ring: null as RingBle | null,
  /** Кто сейчас выгружает: экран, фоновое обновление или никто. */
  running: null as 'screen' | 'background' | null,
  /** Демо-режим включён: в фоне к кольцу не ходим, как и на экране. */
  demo: false,
  /**
   * Экран жив и держит состояние: фоновая выгрузка берёт его и отдаёт результат ему же
   * (тот сохранит и перерисует). Нет экрана — фоновая работает с хранилищем напрямую.
   */
  host: null as { get: () => VueloState; apply: (next: VueloState) => void } | null,
};

/** Кольцо сессии: одно на приложение. */
export function sessionRing(known: KnownRing | null): RingBle {
  ringSession.ring ??= new RingBle(known);
  return ringSession.ring;
}

/** Забыть кольцо: связь рвём, следующее подключение начнётся с нового экземпляра. */
export async function dropSessionRing(): Promise<void> {
  await ringSession.ring?.disconnect();
  ringSession.ring = null;
}

type BackgroundEvent = { kind: 'started' } | { kind: 'finished'; changed: boolean };
const listeners = new Set<(event: BackgroundEvent) => void>();

/** Экран следит за фоновой выгрузкой: статус «Обновляем данные…» и готовое мнение Лиса. */
export function onBackgroundSync(listener: (event: BackgroundEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitBackgroundSync(event: BackgroundEvent): void {
  listeners.forEach((l) => l(event));
}

/** Профиль для команды 0x02. Пока профиль не заполнен — null: «умолчаний» не подставляем. */
export const toRingProfile = (profile: Profile): RingProfile | null => {
  const age = profileAge(profile);
  if (!isProfileComplete(profile) || age === null) return null;
  return { age, heightCm: profile.heightCm as number, weightKg: profile.weightKg as number, male: profile.sex === 'male' };
};
