/**
 * Динамика за неделю: насколько показатель вырос или упал по сравнению с прошлой неделей.
 * Заменяет прежние недельные графики — на экране видно одно понятное число.
 *
 * Считаем по завершённым дням: сегодняшний день ещё идёт (шаги и оценки за него растут
 * до полуночи), и в сравнение он не попадает, иначе неделя всегда выглядела бы хуже.
 */

/** Длина каждого окна сравнения, дней. */
export const TREND_WINDOW_DAYS = 7;
/** Сколько дней с данными нужно в каждом окне, чтобы сравнение имело смысл. */
export const TREND_MIN_DAYS = 3;

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface Trend {
  /** Среднее за последние 7 завершённых дней. */
  current: number | null;
  /** Среднее за 7 дней до них. */
  previous: number | null;
  /** Изменение в процентах, целое; null — сравнивать не с чем. */
  percent: number | null;
  /** Сколько дней с данными попало в каждое окно. */
  currentDays: number;
  previousDays: number;
}

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const average = (values: number[]): number | null =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

/**
 * Две недели до `asOf` (сам день не входит): свежая неделя против предыдущей.
 * Нет хотя бы `TREND_MIN_DAYS` дней с данными в каком-то окне — процент не считаем.
 */
export function weekTrend(points: readonly TrendPoint[], asOf: string): Trend {
  const from = (offset: number) => shiftDate(asOf, -offset);
  const inWindow = (date: string, newest: string, oldest: string) => date <= newest && date >= oldest;
  const pick = (newest: string, oldest: string) =>
    points.filter((p) => p.value !== null && inWindow(p.date, newest, oldest)).map((p) => p.value as number);

  const currentValues = pick(from(1), from(TREND_WINDOW_DAYS));
  const previousValues = pick(from(TREND_WINDOW_DAYS + 1), from(TREND_WINDOW_DAYS * 2));
  const current = average(currentValues);
  const previous = average(previousValues);
  const enough =
    currentValues.length >= TREND_MIN_DAYS && previousValues.length >= TREND_MIN_DAYS && previous !== null && previous > 0;

  return {
    current,
    previous,
    percent: enough && current !== null ? Math.round(((current - previous) / previous) * 100) : null,
    currentDays: currentValues.length,
    previousDays: previousValues.length,
  };
}

/** Подпись под процентом. */
export const trendPhrase = (percent: number): string =>
  percent > 0 ? 'выше прошлой недели' : percent < 0 ? 'ниже прошлой недели' : 'как на прошлой неделе';
