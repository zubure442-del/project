import { describe, expect, it } from 'vitest';
import { TREND_MAX_PERCENT, TREND_MIN_DAYS, TREND_WINDOW_DAYS, trendPhrase, weekTrend, type TrendPoint } from './trend';

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

  it('недели хватает — режим «неделя к неделе»', () => {
    const trend = weekTrend(points([80, 80, 80, 80, 80, 80, 80, 40, 40, 40, 40, 40, 40, 40]), ASOF);
    expect(trend.mode).toBe('weeks');
    expect(trendPhrase(trend.percent as number, trend.mode)).toBe('выше прошлой недели');
  });
});

describe('СИНТЕТИЧЕСКИЕ: пока второй недели нет — свежий день к личной норме', () => {
  it('мало дней в окне — сравниваем свежий день со средним по остальным дням недели', () => {
    const few = weekTrend(points([66, null, null, null, null, 60, null, 40, 40, 40, null, null, null, null]), ASOF);
    expect(few.currentDays).toBeLessThan(TREND_MIN_DAYS);
    expect(few.mode).toBe('norm');
    expect(few.current).toBe(66);
    expect(few.previous).toBe(60);
    expect(few.percent).toBe(10);
    expect(trendPhrase(few.percent as number, few.mode)).toBe('выше вашей нормы');
  });

  it('сегодняшний день тоже идёт в сравнение', () => {
    const trend = weekTrend([{ date: ASOF, value: 90 }, ...points([60, 60, 60])], ASOF);
    expect(trend.mode).toBe('norm');
    expect(trend.current).toBe(90);
    expect(trend.percent).toBe(50);
  });

  it('дикие проценты не показываем: слишком низкая база — процента нет', () => {
    const wild = weekTrend([{ date: ASOF, value: 34 }, ...points([1, 1])], ASOF);
    expect(wild.mode).toBe('norm');
    expect(wild.percent).toBeNull();
  });

  it('очень большое изменение упирается в потолок', () => {
    const big = weekTrend([{ date: ASOF, value: 95 }, ...points([25, 25])], ASOF);
    expect(big.capped).toBe(true);
    expect(big.percent).toBe(TREND_MAX_PERCENT);
  });

  it('один день с данными — сравнивать не с чем', () => {
    const one = weekTrend(points([70]), ASOF);
    expect(one.mode).toBe('none');
    expect(one.percent).toBeNull();
  });

  it('совсем нет данных — режим «нет»', () => {
    expect(weekTrend([], ASOF).mode).toBe('none');
  });

  it('неделя к неделе с низкой базой — процента тоже нет', () => {
    const zero = weekTrend(points([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ASOF);
    expect(zero.mode).toBe('weeks');
    expect(zero.percent).toBeNull();
  });
});
