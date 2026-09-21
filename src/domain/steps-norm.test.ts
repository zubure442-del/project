import { describe, expect, it } from 'vitest';
import type { SyncResult } from '../ble/sync';
import { buildSnapshots } from '../storage/build';
import { activityScore } from './score';
import { NORM_MAX, NORM_MIN, STEPS_DEFAULT_NORM, resolveStepNorm, sleepFactor, stepNorm, stepNormBase } from './steps-norm';

describe('СИНТЕТИЧЕСКИЕ: норма шагов', () => {
  it('новичок без данных — 10 000', () => {
    expect(stepNormBase([])).toBe(STEPS_DEFAULT_NORM);
    expect(stepNorm([], null)).toBe(10000);
  });

  it('два дня данных — смесь своего среднего и 10 000', () => {
    // 2/7 × 6 500 × 1.1 + 5/7 × 10 000 = 9 185.7 → 9 200
    expect(stepNorm([6000, 7000], null)).toBe(9200);
  });

  it('дни, где шагов меньше 1 000, не считаются: кольцо не носили', () => {
    expect(stepNorm([300, 6000, 999, 7000], null)).toBe(9200);
  });

  it('сон 90 повышает норму, сон 20 снижает', () => {
    expect(sleepFactor(90)).toBeCloseTo(1.12);
    expect(stepNorm([], 90)).toBe(11200);
    expect(stepNorm([], 20)).toBe(9100);
    expect(stepNorm([], null)).toBe(10000);
  });

  it('ограничения снизу и сверху', () => {
    expect(stepNorm(new Array(7).fill(20000), 100)).toBe(NORM_MAX);
    expect(stepNorm(new Array(7).fill(1000), 0)).toBe(NORM_MIN);
  });

  it('норма не меняется в течение дня', () => {
    const morning = resolveStepNorm(undefined, [6000, 7000], 90);
    expect(resolveStepNorm(morning, [6000, 7000, 12000], 40)).toBe(morning);
    // Первый расчёт без сна тоже держится, пока сна нет…
    const noSleep = resolveStepNorm(undefined, [], null);
    expect(resolveStepNorm(noSleep, [15000, 15000], null)).toBe(noSleep);
    // …и один раз пересчитывается, когда появилась оценка сна.
    expect(resolveStepNorm(noSleep, [], 90)).toEqual({ value: 11200, withSleep: true });
  });

  it('оценка активности идёт от нормы, а не от 10 000', () => {
    expect(activityScore(5000, [], null, 5000)).toBeGreaterThan(activityScore(5000, [], null) as number);
  });
});

describe('СИНТЕТИЧЕСКИЕ: норма в сводках дня', () => {
  /** Шаги одной минутой в полдень каждого дня (метки кольца — «настенное» время в UTC). */
  const stepsOn = (days: Record<string, number>): SyncResult => ({
    steps: Object.entries(days).map(([date, value]) => ({ ts: Date.parse(`${date}T12:00:00Z`) / 1000, value })),
    sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 }, completeDays: [], error: null, capped: false,
  });

  it('история — семь дней до дня, сам день не входит', () => {
    const snaps = buildSnapshots(stepsOn({ '2026-09-19': 6000, '2026-09-20': 7000, '2026-09-21': 30000 }), 30);
    expect(snaps.find((d) => d.date === '2026-09-21')?.stepNorm).toEqual({ value: 9200, withSleep: false });
  });

  it('сохранённая норма дня берётся как есть, даже если шаги за прошлые дни изменились', () => {
    const saved = { '2026-09-21': { value: 12300, withSleep: true } };
    const snaps = buildSnapshots(stepsOn({ '2026-09-20': 1500, '2026-09-21': 4000 }), 30, saved);
    expect(snaps.find((d) => d.date === '2026-09-21')?.stepNorm?.value).toBe(12300);
  });
});
