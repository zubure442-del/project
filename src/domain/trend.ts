/**
 * Динамика за неделю: насколько показатель вырос или упал по сравнению с прошлой неделей.
 * Заменяет прежние недельные графики — на экране видно одно понятное число.
 *
 * Считаем по завершённым дням: сегодняшний день ещё идёт (шаги и оценки за него растут
 * до полуночи), и в сравнение он не попадает, иначе неделя всегда выглядела бы хуже.
 */

/** Длина каждого окна сравнения, дней. */
export const TREND_WINDOW_DAYS = 7;
/** Сколько дней с данными нужно в каждом окне, чтобы сравнивать неделю с неделей. */
export const TREND_MIN_DAYS = 3;

/**
 * Как посчитано сравнение: неделя к неделе, а пока второй недели нет — свежий день
 * к самому старому дню с данными в пределах недели. Совсем нет данных — `none`.
 */
export type TrendMode = 'weeks' | 'days' | 'none';

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface Trend {
  mode: TrendMode;
  /** Среднее за последние 7 завершённых дней, а в режиме `days` — значение свежего дня. */
  current: number | null;
  /** Среднее за 7 дней до них, а в режиме `days` — значение самого старого дня недели. */
  previous: number | null;
  /** Изменение в процентах, целое; null — сравнивать не с чем. */
  percent: number | null;
  /** Сколько дней с данными попало в каждое окно. */
  currentDays: number;
  previousDays: number;
  /** В режиме `days` — даты сравниваемых дней: их подписывают на полосках. */
  currentDate: string | null;
  previousDate: string | null;
}

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const average = (values: number[]): number | null =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

const percentOf = (current: number | null, previous: number | null): number | null =>
  current !== null && previous !== null && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;

/**
 * Динамика к прошлой неделе. Основной способ — две недели до `asOf` (сам день не входит):
 * свежая неделя против предыдущей. Пока второй недели нет, сравниваем свежий день с самым
 * старым днём с данными в пределах недели — карточка есть на экране с первых дней.
 */
export function weekTrend(points: readonly TrendPoint[], asOf: string): Trend {
  const from = (offset: number) => shiftDate(asOf, -offset);
  const inWindow = (date: string, newest: string, oldest: string) => date <= newest && date >= oldest;
  const known = (newest: string, oldest: string) =>
    points
      .filter((p) => p.value !== null && inWindow(p.date, newest, oldest))
      .map((p) => ({ date: p.date, value: p.value as number }))
      .sort((a, b) => a.date.localeCompare(b.date));

  const currentWeek = known(from(1), from(TREND_WINDOW_DAYS));
  const previousWeek = known(from(TREND_WINDOW_DAYS + 1), from(TREND_WINDOW_DAYS * 2));
  const current = average(currentWeek.map((d) => d.value));
  const previous = average(previousWeek.map((d) => d.value));
  const counts = { currentDays: currentWeek.length, previousDays: previousWeek.length };

  if (currentWeek.length >= TREND_MIN_DAYS && previousWeek.length >= TREND_MIN_DAYS && previous !== null && previous > 0) {
    return { mode: 'weeks', current, previous, percent: percentOf(current, previous), ...counts, currentDate: null, previousDate: null };
  }

  // Запасной способ: свежий день недели (включая сегодняшний) против самого старого дня с данными.
  const week = known(asOf, from(TREND_WINDOW_DAYS - 1));
  if (week.length >= 2) {
    const newest = week[week.length - 1];
    const oldest = week[0];
    return {
      mode: 'days',
      current: newest.value,
      previous: oldest.value,
      percent: percentOf(newest.value, oldest.value),
      ...counts,
      currentDate: newest.date,
      previousDate: oldest.date,
    };
  }

  return { mode: 'none', current, previous, percent: null, ...counts, currentDate: null, previousDate: null };
}

/** Подпись под процентом: неделя к неделе или свежий день к началу недели. */
export const trendPhrase = (percent: number, mode: TrendMode = 'weeks'): string => {
  if (mode === 'days') {
    return percent > 0 ? 'выше, чем в начале недели' : percent < 0 ? 'ниже, чем в начале недели' : 'как в начале недели';
  }
  return percent > 0 ? 'выше прошлой недели' : percent < 0 ? 'ниже прошлой недели' : 'как на прошлой неделе';
};
