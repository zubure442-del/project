/**
 * Подключение к кольцу в две попытки.
 *
 * Кольцо могли вручную отвязать в настройках Bluetooth: тогда сохранённый идентификатор
 * уже ничего не значит, и первая попытка просто висит до таймаута. Поэтому ждём соединение
 * CONNECT_ATTEMPT_MS, а потом пробуем ещё RECONNECT_ATTEMPT_MS — как к новому устройству,
 * с новым поиском в эфире. Не вышло и это — одно понятное сообщение владельцу.
 */
import { RING_NOT_FOUND_MESSAGE } from '../domain/texts';

/** Первая попытка: уже подключённое кольцо, сохранённый идентификатор, поиск по имени. */
export const CONNECT_ATTEMPT_MS = 10000;
/** Вторая попытка: привязку забываем и ищем кольцо заново. */
export const RECONNECT_ATTEMPT_MS = 10000;

/** Ожидание с пределом: задача не отменяется, но ответа дольше `ms` мы не ждём. */
export function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([task, limit]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export interface ConnectSteps {
  /** Обычное подключение: система, известный идентификатор, поиск. */
  known: () => Promise<void>;
  /** Подключение как к новому устройству: привязка сброшена, поиск в эфире заново. */
  fresh: () => Promise<void>;
  /** Началась вторая попытка — для отладочного лога. */
  onRetry?: () => void;
}

/**
 * Две попытки подряд. Первая ошибка (или молчание дольше таймаута) не показывается:
 * о ней узнаёт только лог. Наружу выходит одно сообщение — RING_NOT_FOUND_MESSAGE.
 */
export async function connectWithRetry(steps: ConnectSteps): Promise<void> {
  try {
    await withTimeout(steps.known(), CONNECT_ATTEMPT_MS, RING_NOT_FOUND_MESSAGE);
    return;
  } catch {
    // Первая попытка не удалась: пробуем как с новым кольцом.
  }
  steps.onRetry?.();
  try {
    await withTimeout(steps.fresh(), RECONNECT_ATTEMPT_MS, RING_NOT_FOUND_MESSAGE);
  } catch {
    throw new Error(RING_NOT_FOUND_MESSAGE);
  }
}
