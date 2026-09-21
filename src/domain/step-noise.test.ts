import { describe, expect, it } from 'vitest';
import { applyStepNoise } from './step-noise';

describe('СИНТЕТИЧЕСКИЕ: шумоподавление шагов', () => {
  it('контрольные значения на границах диапазонов', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1500, 900],
      [1501, 1081],
      [5000, 3600],
      [5001, 3601],
      [6000, 4300],
      [7000, 5000],
      [7001, 5001],
      [20000, 18000],
    ];
    for (const [raw, clean] of cases) expect(applyStepNoise(raw), String(raw)).toBe(clean);
  });

  it('отрицательных значений не бывает', () => {
    for (const raw of [-100, 0, 1, 7, 1499]) expect(applyStepNoise(raw)).toBeGreaterThanOrEqual(0);
  });
});
