import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RING_NOT_FOUND_MESSAGE } from '../domain/texts';
import { CONNECT_ATTEMPT_MS, RECONNECT_ATTEMPT_MS, connectWithRetry, withTimeout } from './connect';

/** Задача, которая никогда не ответит: так ведёт себя кольцо после ручной отвязки. */
const forever = () => new Promise<void>(() => undefined);

describe('СИНТЕТИЧЕСКИЕ: подключение к кольцу в две попытки', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('связь есть сразу — второй попытки нет', async () => {
    const fresh = vi.fn(() => Promise.resolve());
    await connectWithRetry({ known: () => Promise.resolve(), fresh });
    expect(fresh).not.toHaveBeenCalled();
  });

  it('первая попытка молчит 10 секунд — начинается вторая, как с новым кольцом', async () => {
    const fresh = vi.fn(() => Promise.resolve());
    const onRetry = vi.fn();
    const task = connectWithRetry({ known: forever, fresh, onRetry });

    await vi.advanceTimersByTimeAsync(CONNECT_ATTEMPT_MS - 1);
    expect(fresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await expect(task).resolves.toBeUndefined();
  });

  it('ошибка первой попытки тоже ведёт ко второй, не дожидаясь таймаута', async () => {
    const fresh = vi.fn(() => Promise.resolve());
    const task = connectWithRetry({ known: () => Promise.reject(new Error('нет такого устройства')), fresh });
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh).toHaveBeenCalledTimes(1);
    await expect(task).resolves.toBeUndefined();
  });

  it('обе попытки молчат 10 + 10 секунд — одно понятное сообщение', async () => {
    const task = connectWithRetry({ known: forever, fresh: forever });
    const caught = task.catch((e: Error) => e.message);

    await vi.advanceTimersByTimeAsync(CONNECT_ATTEMPT_MS + RECONNECT_ATTEMPT_MS - 1);
    let settled = false;
    void caught.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(caught).resolves.toBe(RING_NOT_FOUND_MESSAGE);
  });

  it('сообщение — про заряд и настройки Bluetooth', () => {
    expect(RING_NOT_FOUND_MESSAGE).toBe(
      'Кольцо не найдено. Возможно, села зарядка или произошла ошибка Bluetooth-соединения. ' +
        'Попробуйте забыть устройство в настройках Bluetooth и подключиться заново.',
    );
  });

  it('оба таймаута — по 10 секунд', () => {
    expect(CONNECT_ATTEMPT_MS).toBe(10000);
    expect(RECONNECT_ATTEMPT_MS).toBe(10000);
  });

  it('withTimeout пропускает быстрый ответ и обрывает долгий', async () => {
    await expect(withTimeout(Promise.resolve(7), 100, 'поздно')).resolves.toBe(7);
    const slow = withTimeout(forever(), 100, 'поздно');
    const caught = slow.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(100);
    await expect(caught).resolves.toBe('поздно');
  });
});
