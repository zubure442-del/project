import { describe, expect, it } from 'vitest';
import { adviceDay, glucoseRises, type AdviceDayInput, type MinutePoint } from './advice-days';

/** Глюкоза раз в 30 минут с 7:00 на уровне 6.0 и подъёмы после еды в заданные минуты. */
const glucoseDay = (rises: number[], until = 23 * 60) =>
  Array.from({ length: (until - 420) / 30 + 1 }, (_, i) => {
    const m = 420 + i * 30;
    return { m, glucose: rises.some((r) => m >= r && m < r + 60) ? 7.6 : 6 };
  });
const points = (values: [number, number][]): MinutePoint[] => values.map(([m, v]) => ({ m, v }));

const day = (): AdviceDayInput => ({
  sleepSegments: [
    { from: -50, to: 120 },
    { from: 120, to: 430 },
  ],
  sleep: { totalMin: 440, deepMin: 75 },
  nightHr: { avg: 56.4 },
  estimates: { hrv: 48.6 },
  restingHr: 54,
  spo2: points([[100, 97], [200, 96], [300, 98]]),
  stress: points([[120, 8], [600, 30], [700, 50], [800, 40], [1300, 70]]),
  steps: 9400,
  stepNorm: { value: 9000 },
  calories: 410,
  load: { trimp: 38.2, session: 'cardio' },
  summaryPoints: glucoseDay([480, 780, 1290]),
});

describe('СИНТЕТИЧЕСКИЕ: таблица чисел для «Мнения Лиса»', () => {
  it('строка дня: только числа и времена, без выводов', () => {
    expect(adviceDay(1, day(), 6)).toEqual({
      ago: 1,
      asleep: '23:10',
      awake: '07:10',
      sleepMin: 440,
      deepMin: 75,
      nightPulse: 56,
      hrv: 49,
      restingPulse: 54,
      quietPulse: null,
      spo2: 97,
      nightSpo2: 97,
      systolic: null,
      diastolic: null,
      glucoseRange: 1.6,
      stress: 40,
      steps: 9400,
      stepNorm: 9000,
      calories: 410,
      load: 38,
      workout: 'cardio',
      meals: ['08:00', '13:00', '21:30'],
    });
  });

  it('стресс — только днём (9:00–21:00): ночные низкие и поздние замеры не входят', () => {
    expect(adviceDay(1, day(), 6).stress).toBe(40);
  });

  it('сегодня — до времени данных: подъёмы и стресс после него не считаются', () => {
    const today = adviceDay(0, day(), 6, 11 * 60);
    expect(today.meals).toEqual(['08:00']);
    expect(today.stress).toBe(30);
  });

  it('нет данных — null, а не ноль', () => {
    const empty: AdviceDayInput = {
      sleepSegments: [], sleep: null, nightHr: null, estimates: { hrv: null }, restingHr: null,
      spo2: [], stress: [], steps: null, calories: null, load: null, summaryPoints: [],
    };
    const row = adviceDay(3, empty, 6);
    expect(row.asleep).toBeNull();
    expect(row.sleepMin).toBeNull();
    expect(row.spo2).toBeNull();
    expect(row.stress).toBeNull();
    expect(row.stepNorm).toBeNull();
    expect(row.meals).toEqual([]);
  });

  it('подъём глюкозы: замер выше уровня на 15 % после замера ниже', () => {
    expect(glucoseRises(points([[480, 6], [510, 7.6], [540, 7.6], [570, 6], [600, 7.2]]), 6)).toEqual([510, 600]);
  });
});
