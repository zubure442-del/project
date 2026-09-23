import { describe, expect, it } from 'vitest';
import {
  FLASK_DEFAULT_G_MID,
  FLASK_DEFAULT_G_MIN,
  FLASK_DEFAULT_N_HOURS,
  FLASK_E_LIMITS,
  FLASK_FAT_HOURS,
  FLASK_LAYER,
  FLASK_TOP_GAIN,
  efficiency,
  flaskState,
  flaskStats,
  type FlaskStats,
  type GlucosePoint,
} from './flask';

const STATS: FlaskStats = { gMid: 5.5, gMin: 4.3, nHours: 3 };
/** Ряд замеров каждые 15 минут от указанной минуты. */
const series = (from: number, count: number, v: number, step = 15): GlucosePoint[] =>
  Array.from({ length: count }, (_, i) => ({ m: from + i * step, v }));

describe('СИНТЕТИЧЕСКИЕ: личные константы колбы', () => {
  it('нет данных — значения по умолчанию', () => {
    expect(flaskStats([])).toEqual({
      gMid: FLASK_DEFAULT_G_MID,
      gMin: FLASK_DEFAULT_G_MIN,
      nHours: FLASK_DEFAULT_N_HOURS,
    });
  });

  it('G_mid — среднее суточных средних, G_min — по самым низким точкам дня', () => {
    const day = [
      { m: 0, v: 4 },
      { m: 60, v: 4.2 },
      { m: 120, v: 4.4 },
      { m: 180, v: 7.4 },
    ];
    const stats = flaskStats([day, day]);
    expect(stats.gMid).toBeCloseTo(5, 6); // (4 + 4.2 + 4.4 + 7.4) / 4
    expect(stats.gMin).toBeCloseTo(4.2, 6); // среднее трёх низших
  });

  it('N — часы от пика еды до возвращения к среднему', () => {
    // Обед: пик в 13:00, ниже среднего — в 15:00. Два часа.
    const day = [
      { m: 11 * 60, v: 4.5 },
      { m: 13 * 60, v: 8 },
      { m: 14 * 60, v: 6 },
      { m: 15 * 60, v: 4.6 },
      { m: 18 * 60, v: 4.4 },
    ];
    expect(flaskStats([day]).nHours).toBeCloseTo(2, 6);
  });

  it('разброс между средним и минимумом не схлопывается', () => {
    const flat = [
      { m: 0, v: 5 },
      { m: 60, v: 5 },
    ];
    const stats = flaskStats([flat]);
    expect(stats.gMid - stats.gMin).toBeGreaterThan(0);
  });
});

describe('СИНТЕТИЧЕСКИЕ: коэффициент эффективности', () => {
  it('сахар у среднего — медленно, у минимума — быстро', () => {
    expect(efficiency(STATS.gMid, STATS)).toBe(FLASK_E_LIMITS.min);
    expect(efficiency(STATS.gMin, STATS)).toBeCloseTo(1, 6);
    expect(efficiency(3, STATS)).toBe(FLASK_E_LIMITS.max);
    expect(efficiency(5, STATS)).toBeCloseTo(0.5, 6);
  });
});

describe('СИНТЕТИЧЕСКИЕ: уровень колбы по слоям', () => {
  const base = { stats: STATS, calories: null as number | null };

  it('замеров нет — колбы нет', () => {
    expect(flaskState({ ...base, points: [], nowMinute: 600 })).toBeNull();
  });

  it('поел: сахар выше среднего — полный сброс, колба пустая', () => {
    const state = flaskState({ ...base, points: [{ m: 540, v: 7.2 }], nowMinute: 600 });
    expect(state).toMatchObject({ stage: 'processing', fill: 0, hours: 0 });
  });

  it('нижний слой наполняется за N часов после падения ниже среднего', () => {
    const points = [{ m: 480, v: 6 }, ...series(540, 8, 5)];
    // Падение в 9:00, сейчас 10:30 — половина от трёх часов.
    const half = flaskState({ ...base, points, nowMinute: 630 });
    expect(half?.stage).toBe('processing');
    expect(half?.fill).toBeCloseTo(FLASK_LAYER / 2, 6);
    // Ровно через N часов слой полон.
    const full = flaskState({ ...base, points, nowMinute: 540 + STATS.nHours * 60 });
    expect(full?.fill).toBeCloseTo(FLASK_LAYER, 6);
  });

  it('средний слой: скорость зависит от того, насколько прижат сахар', () => {
    const low = [{ m: 0, v: 6 }, ...series(60, 60, STATS.gMin)];
    const high = [{ m: 0, v: 6 }, ...series(60, 60, 5.2)];
    const at = 60 + (STATS.nHours + FLASK_FAT_HOURS / 2) * 60; // половина среднего слоя
    const fast = flaskState({ ...base, points: low, nowMinute: at });
    const slow = flaskState({ ...base, points: high, nowMinute: at });
    expect(fast?.stage).toBe('fat');
    expect(slow?.stage).toBe('fat');
    expect(fast?.fill).toBeGreaterThan(slow?.fill as number);
    expect(fast?.fill).toBeCloseTo(FLASK_LAYER + FLASK_LAYER / 2, 6);
  });

  it('верхний слой растёт асимптотически и не доходит до краёв', () => {
    const points = [{ m: -600, v: 6 }, ...series(-540, 200, STATS.gMin)];
    const long = flaskState({ ...base, points, nowMinute: 1400 });
    expect(long?.stage).toBe('autophagy');
    expect(long?.fill).toBeGreaterThan(2 * FLASK_LAYER);
    expect(long?.fill).toBeLessThan(2 * FLASK_LAYER + FLASK_TOP_GAIN);
    expect(long?.fill).toBeLessThan(100);
  });

  it('активность за день ускоряет верхний слой', () => {
    const points = [{ m: -600, v: 6 }, ...series(-540, 200, STATS.gMin)];
    const calm = flaskState({ ...base, points, nowMinute: 1000 });
    const active = flaskState({ ...base, points, nowMinute: 1000, calories: 1000 });
    expect(active?.effectiveHours).toBeGreaterThan(calm?.effectiveHours as number);
    expect(active?.fill).toBeGreaterThan(calm?.fill as number);
  });

  it('слои идут по порядку: чем дольше без еды, тем выше вода', () => {
    const points = [{ m: 0, v: 6 }, ...series(60, 96, STATS.gMin)];
    const levels = [120, 300, 600, 1200].map((now) => flaskState({ ...base, points, nowMinute: now }));
    expect(levels.map((l) => l?.stage)).toEqual(['processing', 'fat', 'fat', 'autophagy']);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]?.fill).toBeGreaterThan(levels[i - 1]?.fill as number);
    }
  });
});
