import { describe, expect, it } from 'vitest';
import { TREND_MIN_DAYS, TREND_WINDOW_DAYS, trendPhrase, weekTrend, type TrendPoint } from './trend';

const ASOF = '2026-09-22';
const dateAt = (back: number) => new Date(Date.parse(`${ASOF}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
/** Дни от вчерашнего назад: values[0] — вчера. */
const points = (values: (number | null)[]): TrendPoint[] => values.map((value, i) => ({ date: dateAt(i + 1), value }));

describe('СИНТЕТИЧЕСКИЕ: динамика за неделю', () => {
  it('окна — семь дней против семи, сегодняшний день не входит', () => {
    expect(TREND_WINDOW_DAYS).toBe(7);
    const withToday = [{ date: ASOF, value: 0 }, ...points([80, 80, 80, 80, 80, 80, 80, 40, 40, 40, 40, 40, 40, 40])];
    const trend = weekTrend(withToday, ASOF);
    expect(trend.current).toBe(80);
    expect(trend.previous).toBe(40);
    expect(trend.percent).toBe(100);
    expect(trend.currentDays).toBe(7);
  });

  it('падение — отрицательный процент', () => {
    const trend = weekTrend(points([45, 45, 45, 45, 45, 45, 45, 60, 60, 60, 60, 60, 60, 60]), ASOF);
    expect(trend.percent).toBe(-25);
    expect(trendPhrase(trend.percent as number)).toBe('ниже прошлой недели');
  });

  it('без изменений — ноль и нейтральная подпись', () => {
    const trend = weekTrend(points([70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]), ASOF);
    expect(trend.percent).toBe(0);
    expect(trendPhrase(0)).toBe('как на прошлой неделе');
  });

  it('дни без данных не учитываются, среднее — по имеющимся', () => {
    const trend = weekTrend(points([90, null, 60, 75, null, null, null, 50, 50, 50, null, null, null, null]), ASOF);
    expect(trend.current).toBe(75);
    expect(trend.previous).toBe(50);
    expect(trend.percent).toBe(50);
    expect(trend.currentDays).toBe(3);
    expect(trend.previousDays).toBe(3);
  });

  it('мало дней в окне — процента нет, но среднее за неделю есть', () => {
    const few = weekTrend(points([80, 80, null, null, null, null, null, 40, 40, 40, null, null, null, null]), ASOF);
    expect(few.currentDays).toBeLessThan(TREND_MIN_DAYS);
    expect(few.percent).toBeNull();
    expect(few.current).toBe(80);
  });

  it('второй недели нет вовсе — сравнивать не с чем', () => {
    const only = weekTrend(points([70, 72, 68, 74, 70, 71, 69]), ASOF);
    expect(only.previous).toBeNull();
    expect(only.percent).toBeNull();
    expect(only.current).toBe(70.6);
  });

  it('прошлая неделя по нулям — процент не считаем, на ноль не делим', () => {
    const zero = weekTrend(points([50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ASOF);
    expect(zero.percent).toBeNull();
  });
});
