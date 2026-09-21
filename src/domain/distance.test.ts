import { describe, expect, it } from 'vitest';
import { applyStepNoise } from './step-noise';
import { distanceMeters, formatDistance } from './distance';

describe('СИНТЕТИЧЕСКИЕ: дистанция на «Сегодня»', () => {
  it('шаги после шумоподавления × рост × 0.414', () => {
    // 4 016 сырых → 2 892 после шумоподавления; × 1.87 м × 0.414 ≈ 2 239 м
    expect(distanceMeters(applyStepNoise(4016), 187)).toBeCloseTo(2239, 0);
  });

  it('меньше километра — метры, иначе километры с одной цифрой', () => {
    expect(formatDistance(847)).toBe('850 м');
    expect(formatDistance(999)).toBe('1000 м');
    expect(formatDistance(3240)).toBe('3.2 км');
    expect(formatDistance(1000)).toBe('1.0 км');
  });
});
