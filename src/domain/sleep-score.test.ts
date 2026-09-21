import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SLEEP_BONUS_MAX,
  activitySleepBonus,
  earliness,
  sleepScore,
  wakeComponent,
  wakeConsistency,
} from './score';
import type { SleepSession } from './sleep';

/** Ночь с подъёмом в заданную минуту (метки кольца — «настенное» время в UTC). */
const nightEnding = (wakeMinute: number, light = 336, deep = 84): SleepSession => {
  const end = Date.parse('2026-09-21T00:00:00Z') / 1000 + wakeMinute * 60;
  return { start: end - (light + deep) * 60, end, deepMin: deep, lightMin: light, awakeMin: 0, date: '2026-09-21' };
};

describe('СИНТЕТИЧЕСКИЕ: сон — время пробуждения', () => {
  it('ранность: 5:00 и раньше — 100, 11:00 и позже — 0, между — линейно', () => {
    expect(earliness(240)).toBe(100);
    expect(earliness(300)).toBe(100);
    expect(earliness(480)).toBe(50);
    expect(earliness(660)).toBe(0);
    expect(earliness(720)).toBe(0);
  });

  it('постоянство: меньше трёх прошлых ночей — нет; при истории — от разброса подъёма', () => {
    expect(wakeConsistency([420, 430], 425)).toBeNull();
    expect(wakeConsistency([420, 420, 420], 420)).toBe(100);
    // разброс 45 минут → 100 − 45 × 100/90 = 50
    expect(wakeConsistency([375, 465, 375], 465)).toBeCloseTo(50);
  });

  it('компонент пробуждения: 0.6 × ранность + 0.4 × постоянство, без истории — только ранность', () => {
    expect(wakeComponent(480)).toBe(50);
    expect(wakeComponent(480, [480, 480, 480])).toBe(0.6 * 50 + 0.4 * 100);
  });
});

describe('СИНТЕТИЧЕСКИЕ: сон — бонус активности и итог', () => {
  it('бонус за вчерашнюю активность: 0 … 10, нет оценки — 0', () => {
    expect(activitySleepBonus(null)).toBe(0);
    expect(activitySleepBonus(0)).toBe(0);
    expect(activitySleepBonus(50)).toBe(5);
    expect(activitySleepBonus(100)).toBe(ACTIVITY_SLEEP_BONUS_MAX);
  });

  it('итог сна: 0.45 длительность + 0.25 глубина + 0.20 пробуждение + бонус, не больше 100', () => {
    // 7 ч, 20 % глубокого, подъём в 5:00 → 45 + 25 + 20 = 90; с бонусом 10 → 100
    expect(sleepScore(nightEnding(300))).toBe(90);
    expect(sleepScore(nightEnding(300), { yesterdayActivity: 100 })).toBe(100);
    // Больше 100 не бывает, даже с идеальным постоянством и бонусом.
    expect(sleepScore(nightEnding(300), { previousWakes: [300, 300, 300], yesterdayActivity: 100 })).toBe(100);
    // Короткая поздняя ночь без глубокого сна — низкая оценка, но не ниже 0.
    const poor = sleepScore(nightEnding(700, 120, 0)) as number;
    expect(poor).toBeGreaterThanOrEqual(0);
    expect(poor).toBeLessThan(30);
  });
});
