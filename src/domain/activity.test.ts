import { describe, expect, it } from 'vitest';
import { busiestHour, loadIntervals } from './charts';
import {
  HOUR_LOAD_HR_WEIGHT,
  HOUR_LOAD_STEPS_WEIGHT,
  MERGE_GAP_MIN,
  MIN_EPISODE_MIN,
  STEP_MIN_PER_MIN,
  maxHeartRate,
} from './score';

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

describe('эпизоды нагрузки', () => {
  const maxHr = maxHeartRate(30);
  const hot = Math.round(maxHr * 0.75);
  const minutes = (from: number, count: number, v: number) =>
    Array.from({ length: count }, (_, i) => ({ m: from + i, v }));

  it('прогулка по шагам находится даже без замеров пульса', () => {
    // 20.09: вечерняя прогулка, пульс кольцо в это время не мерило
    const steps = minutes(20 * 60, 90, STEP_MIN_PER_MIN + 10);
    const zones = loadIntervals([], 30, steps, 55);
    expect(zones).toHaveLength(1);
    expect(zones[0].from).toBe(20 * 60);
    expect(zones[0].steps).toBeGreaterThan(2000);
    expect(zones[0].peak).toBeNull();
  });

  it('тренировка без шагов находится по пульсу', () => {
    const heart = minutes(7 * 60, MIN_EPISODE_MIN + 5, hot);
    const zones = loadIntervals(heart, 30, [], 55);
    expect(zones).toHaveLength(1);
    expect(zones[0].peak).toBe(hot);
  });

  it('эпизод короче порога отбрасывается', () => {
    expect(loadIntervals([], 30, minutes(600, MIN_EPISODE_MIN - 1, 30), 55)).toEqual([]);
    expect(loadIntervals([], 30, minutes(600, MIN_EPISODE_MIN + 1, 30), 55)).toHaveLength(1);
  });

  it('пауза больше MERGE_GAP_MIN разрывает эпизоды', () => {
    const first = minutes(600, MIN_EPISODE_MIN + 1, 30);
    const second = minutes(600 + MIN_EPISODE_MIN + MERGE_GAP_MIN + 5, MIN_EPISODE_MIN + 1, 30);
    expect(loadIntervals([], 30, [...first, ...second], 55)).toHaveLength(2);
  });

  it('спокойные минуты эпизодом не считаются', () => {
    expect(loadIntervals(minutes(600, 60, 62), 30, minutes(600, 60, 3), 55)).toEqual([]);
  });

  it('без возраста и без шагов эпизодов нет', () => {
    expect(loadIntervals([{ m: 600, v: 170 }], null)).toEqual([]);
  });
});
