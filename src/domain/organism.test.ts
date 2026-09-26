import { describe, expect, it } from 'vitest';
import {
  organismParts,
  DEFAULT_HRV_BASELINE_MS,
  DEFAULT_PULSE_BASELINE_BPM,
  bpSubScore,
  dayOrganism,
  glucoseSubScore,
  hrvSubScore,
  organismSamples,
  oxygenSubScore,
  personalBaseline,
  pulseSubScore,
  sampleScore,
  type OrganismSample,
} from './organism';

const BASE = { hrv: 50, pulse: 65 };
const sample = (m: number, patch: Partial<OrganismSample>): OrganismSample => ({
  m, hrv: null, pulse: null, oxygen: null, systolic: null, diastolic: null, glucose: null, ...patch,
});

describe('СИНТЕТИЧЕСКИЕ: «Организм» v2 — подоценки', () => {
  it('вариабельность и пульс — от личного ориентира', () => {
    expect(hrvSubScore(60, 50)).toBeCloseTo(90);
    expect(hrvSubScore(25, 50)).toBe(0);
    expect(pulseSubScore(60, 65)).toBeCloseTo(73.08, 1);
    expect(pulseSubScore(80, 65)).toBe(0);
  });

  it('кислород, давление, глюкоза — прежние абсолютные пороги', () => {
    expect(oxygenSubScore(97)).toBe(100);
    expect(oxygenSubScore(93)).toBe(60);
    expect(bpSubScore(118, 76)).toBe(100);
    expect(bpSubScore(125, 82)).toBe(70);
    expect(bpSubScore(140, 90)).toBe(50);
    expect(glucoseSubScore(5)).toBe(100);
    expect(glucoseSubScore(6.2)).toBeCloseTo(60);
  });

  it('веса нормируются по тем показателям, что есть в замере; меньше двух — оценки нет', () => {
    // (0.30 × 90 + 0.20 × 100) / 0.50 = 94
    expect(sampleScore(sample(0, { hrv: 60, oxygen: 97 }), BASE)).toBeCloseTo(94);
    expect(sampleScore(sample(0, { hrv: 60 }), BASE)).toBeNull();
  });

  it('пульс замера — минимальный за день к этому моменту, кислород — ближайший', () => {
    const [first, second] = organismSamples(
      [{ m: 60, systolic: null, diastolic: null, glucose: null, hrv: 50 }, { m: 120, systolic: null, diastolic: null, glucose: null, hrv: 50 }],
      [{ m: 10, v: 70 }, { m: 90, v: 58 }, { m: 200, v: 40 }],
      [{ m: 125, v: 97 }],
    );
    expect(first).toMatchObject({ pulse: 70, oxygen: null });
    expect(second).toMatchObject({ pulse: 58, oxygen: 97 });
  });
});

describe('СИНТЕТИЧЕСКИЕ: «Организм» v2 — оценка дня', () => {
  const good = { hrv: 75, oxygen: 98 }; // 100 и 100
  const bad = { hrv: 25, oxygen: 90 }; // 0 и 0

  it('среднее по замерам, взвешенное по покрытию; разрыв не растягивает замер больше 30 минут', () => {
    const samples = [
      ...Array.from({ length: 4 }, (_, i) => sample(480 + i * 30, good)),
      ...Array.from({ length: 4 }, (_, i) => sample(900 + i * 30, bad)),
    ];
    const day = dayOrganism(samples, BASE);
    expect(day.coverageMin).toBe(240);
    expect(day.score).toBeCloseTo(50);
  });

  it('последний замер сегодня покрывает время только до текущего момента', () => {
    const samples = Array.from({ length: 9 }, (_, i) => sample(480 + i * 30, good));
    expect(dayOrganism(samples, BASE, 480 + 8 * 30 + 10).coverageMin).toBe(250);
  });

  it('покрытие меньше 4 часов — оценки нет', () => {
    const samples = Array.from({ length: 7 }, (_, i) => sample(480 + i * 30, good));
    expect(dayOrganism(samples, BASE)).toEqual({ score: null, coverageMin: 210 });
  });

  it('личный ориентир: меньше 5 дней истории — запасные значения, иначе среднее', () => {
    const four = Array.from({ length: 4 }, () => ({ hrv: 80, pulse: 50 }));
    expect(personalBaseline(four)).toEqual({ hrv: DEFAULT_HRV_BASELINE_MS, pulse: DEFAULT_PULSE_BASELINE_BPM });
    const five = [...four, { hrv: 30, pulse: 60 }];
    expect(personalBaseline(five)).toEqual({ hrv: 70, pulse: 52 });
  });

  it('составляющие сегодня против обычного — теми же подоценками, что и сама оценка (что тянет Организм)', () => {
    const sample = (hrv: number | null, oxygen: number | null) =>
      ({ m: 600, hrv, pulse: null, oxygen, systolic: null, diastolic: null, glucose: null });
    const baseline = { hrv: 50, pulse: 60 };
    const parts = organismParts([sample(40, 97)], [[sample(50, 97)], [sample(50, null)], [sample(55, 98)]], baseline);
    expect(parts.hrv?.today).toBe(10);
    expect(parts.hrv?.usual).toBeCloseTo((50 + 50 + 70) / 3);
    // Кислород был только в двух прошлых днях — этого хватает.
    expect(parts.oxygen).toBeDefined();
    // Давления сегодня нет — и составляющей нет.
    expect(parts.bp).toBeUndefined();
    expect(organismParts([sample(40, null)], [[sample(50, null)]], baseline)).toEqual({});
  });
});
