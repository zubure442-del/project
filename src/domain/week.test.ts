import { describe, expect, it } from 'vitest';
import type { DaySnapshot } from '../storage';
import { MIN_STEPS_FOR_DAY, hasData, visibleDays } from './week';

const day = (over: Partial<DaySnapshot> = {}): DaySnapshot => ({
  date: '2026-09-20', total: 50, scores: { sleep: null, activity: 50, state: null }, steps: 0, sleep: null,
  restingHr: null, restingHrSource: null, stateInputs: { hrv: false, restingHr: false, spo2: false },
  heart: [], spo2: [], stress: [], summaryPoints: [], stepsByHour: new Array(24).fill(0), stepsByMinute: [], sleepSegments: [],
  estimates: { hrv: null, glucose: null, systolic: null, diastolic: null, stress: null },
  ...over,
});

const night = { totalMin: 300, deepMin: 60, lightMin: 240 };

describe('какие дни попадают в неделю', () => {
  it('день с сном или заметными шагами считается непустым', () => {
    expect(hasData(day({ sleep: night }))).toBe(true);
    expect(hasData(day({ steps: MIN_STEPS_FOR_DAY }))).toBe(true);
    expect(hasData(day({ steps: MIN_STEPS_FOR_DAY - 1 }))).toBe(false);
    expect(hasData(day({ steps: null }))).toBe(false);
    expect(hasData(null)).toBe(false);
  });

  it('дни до первого замера не показываем', () => {
    const week = [
      { date: '2026-09-14', day: null },
      { date: '2026-09-15', day: null },
      { date: '2026-09-16', day: day({ date: '2026-09-16', sleep: night }) },
      { date: '2026-09-17', day: day({ date: '2026-09-17', steps: 4000 }) },
    ];
    expect(visibleDays(week).map((d) => d.date)).toEqual(['2026-09-16', '2026-09-17']);
  });

  it('пропуск внутри интервала остаётся: разрыв должен быть виден', () => {
    const week = [
      { date: '2026-09-16', day: day({ date: '2026-09-16', sleep: night }) },
      { date: '2026-09-17', day: null },
      { date: '2026-09-18', day: day({ date: '2026-09-18', steps: 4000 }) },
    ];
    expect(visibleDays(week).map((d) => d.date)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
  });

  it('совсем без данных неделя пустая', () => {
    expect(visibleDays([{ date: '2026-09-16', day: null }])).toEqual([]);
  });
});
