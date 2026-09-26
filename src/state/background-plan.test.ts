import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, type DaySnapshot, type VueloState } from '../storage';
import { QUIET_DEFAULT, backgroundSkip, inQuietHours, quietHours } from './background-plan';

/** Ночь: засыпание и подъём — минуты от полуночи дня пробуждения (вечер — отрицательные). */
const night = (from: number, to: number) => ({ sleepSegments: [{ from, to }] }) as unknown as DaySnapshot;
const at = (h: number, m = 0) => new Date(2026, 8, 26, h, m);

const ready: VueloState = {
  ...EMPTY_STATE,
  started: true,
  ring: { id: 'ring', serviceUuid: 'svc' },
  lastSyncAt: at(6).getTime(),
  days: [night(-60, 420), night(-30, 450), night(-45, 435)],
};

describe('СИНТЕТИЧЕСКИЕ: фоновое обновление — когда идти к кольцу', () => {
  it('тихие часы — свой обычный сон; меньше трёх ночей — 23:00–07:00', () => {
    // Засыпание в среднем 23:15, подъём 07:15.
    expect(quietHours(ready)).toEqual({ from: 23 * 60 + 15, to: 7 * 60 + 15 });
    expect(quietHours({ days: [night(-60, 420)] })).toEqual(QUIET_DEFAULT);
    // Сова: засыпает после полуночи, встаёт в 10:00 — тихие часы тоже после полуночи.
    expect(quietHours({ days: [night(90, 600), night(60, 600), night(120, 600)] })).toEqual({ from: 90, to: 600 });
  });

  it('тихие часы через полночь и внутри суток', () => {
    expect(inQuietHours(ready, at(23, 30))).toBe(true);
    expect(inQuietHours(ready, at(3))).toBe(true);
    expect(inQuietHours(ready, at(7, 20))).toBe(false);
    expect(inQuietHours(ready, at(14))).toBe(false);
    const owl = { days: [night(90, 600), night(60, 600), night(120, 600)] };
    expect(inQuietHours(owl, at(0, 30))).toBe(false);
    expect(inQuietHours(owl, at(5))).toBe(true);
    expect(inQuietHours(owl, at(10, 5))).toBe(false);
  });

  it('идём к кольцу, только если есть что забрать и никому не мешаем', () => {
    const free = { busy: false, demo: false };
    // Утро после подъёма, последняя выгрузка в 6:00 — идём.
    expect(backgroundSkip(ready, free, at(8))).toBeNull();
    expect(backgroundSkip({ ...ready, started: false }, free, at(8))).toBe('not-started');
    expect(backgroundSkip({ ...ready, ring: null }, free, at(8))).toBe('no-ring');
    expect(backgroundSkip(ready, { busy: false, demo: true }, at(8))).toBe('demo');
    expect(backgroundSkip(ready, { busy: true, demo: false }, at(8))).toBe('busy');
    // Выгружали 5 минут назад — данные свежие (правило 10 минут).
    expect(backgroundSkip({ ...ready, lastSyncAt: at(7, 55).getTime() }, free, at(8))).toBe('fresh');
    // Ночью, во время обычного сна, кольцо не трогаем.
    const evening = { ...ready, lastSyncAt: new Date(2026, 8, 25, 22, 0).getTime() };
    expect(backgroundSkip(evening, free, at(2))).toBe('quiet');
  });
});
