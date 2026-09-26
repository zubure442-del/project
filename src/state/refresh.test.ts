import { describe, expect, it } from 'vitest';
import { PULL_REFRESH_DISTANCE, pulledToRefresh } from './refresh';

/**
 * Нативного контрола с иконкой нет: обновление по отпусканию оттянутого экрана.
 * Залипнуть на экране нечему — ни при переключении вкладки посреди жеста, ни при экране загрузки.
 */
describe('СИНТЕТИЧЕСКИЕ: обновление жестом без иконки', () => {
  it('оттянули дальше порога и отпустили — обновляем', () => {
    expect(pulledToRefresh(-PULL_REFRESH_DISTANCE)).toBe(true);
    expect(pulledToRefresh(-PULL_REFRESH_DISTANCE - 40)).toBe(true);
  });

  it('чуть потянули, обычная прокрутка или отскок — не обновляем', () => {
    expect(pulledToRefresh(-PULL_REFRESH_DISTANCE + 1)).toBe(false);
    expect(pulledToRefresh(0)).toBe(false);
    expect(pulledToRefresh(350)).toBe(false);
  });
});
