import { describe, expect, it } from 'vitest';
import { busiestHour, loadIntervals } from './charts';
import { HOUR_LOAD_HR_WEIGHT, HOUR_LOAD_STEPS_WEIGHT, maxHeartRate } from './score';

const hours = (pairs: Record<number, number>) =>
  Array.from({ length: 24 }, (_, h) => pairs[h] ?? 0);

describe('самый активный час', () => {
  it('без пульса выбирает час с наибольшими шагами', () => {
    expect(busiestHour(hours({ 8: 1200, 19: 3000 }), [], null)).toBe(19);
  });

  it('тренировка без шагов перевешивает прогулку', () => {
    const maxHr = maxHeartRate(30);
    // в 7 утра высокий пульс без шагов, в 19 — много шагов при пульсе покоя
    const heart = [
      { m: 7 * 60, v: Math.round(maxHr * 0.9) },
      { m: 7 * 60 + 30, v: Math.round(maxHr * 0.9) },
      { m: 19 * 60, v: 70 },
    ];
    expect(HOUR_LOAD_HR_WEIGHT).toBeGreaterThan(0);
    expect(HOUR_LOAD_STEPS_WEIGHT).toBeGreaterThan(0);
    // шагов в 19:00 ровно столько, чтобы вклад шагов был меньше вклада кардио
    expect(busiestHour(hours({ 7: 200, 19: 1000 }), heart, 30)).toBe(7);
  });

  it('пустой день — часа нет', () => {
    expect(busiestHour(hours({}), [], 30)).toBeNull();
  });
});

describe('периоды нагрузки', () => {
  it('соседние замеры в зоне сливаются в один отрезок', () => {
    const maxHr = maxHeartRate(30);
    const heart = [
      { m: 1090, v: Math.round(maxHr * 0.75) },
      { m: 1120, v: Math.round(maxHr * 0.8) },
      { m: 1300, v: 60 },
    ];
    const zones = loadIntervals(heart, 30);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ from: 1090, to: 1120 });
    expect(zones[0].peak).toBeGreaterThan(maxHr * 0.75);
  });

  it('без возраста зоны не считаем: максимальный пульс неизвестен', () => {
    expect(loadIntervals([{ m: 600, v: 170 }], null)).toEqual([]);
  });
});
