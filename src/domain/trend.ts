/**
 * Динамика за неделю: насколько показатель вырос или упал. На экране — только процент,
 * без чисел по дням: подробности смотреть негде и незачем.
 *
 * Считаем по завершённым дням: сегодняшний день ещё идёт (шаги и оценки за него растут
 * до полуночи), и в недельное сравнение он не попадает, иначе неделя всегда выглядела бы хуже.
 * Пока второй недели нет, сравниваем свежий день с личной нормой — средним по остальным дням
 * недели. Сравнение с одним старым днём давало дикие проценты вроде «+3300 %».
 */

/** Длина каждого окна сравнения, дней. */
export const TREND_WINDOW_DAYS = 7;
/** Сколько дней с данными нужно в каждом окне, чтобы сравнивать неделю с неделей. */
export const TREND_MIN_DAYS = 3;
/** База ниже этого — процент не показываем: он был бы бессмысленно большим. */
export const TREND_MIN_BASE = 20;
/** Потолок процента: выше пишем «больше 200 %», а не точное число. */
export const TREND_MAX_PERCENT = 200;

/**
 * Как посчитано сравнение: неделя к неделе, а пока второй недели нет — свежий день
 * к личной норме (среднему по остальным дням недели). Совсем нет данных — `none`.
 */
export type TrendMode = 'weeks' | 'norm' | 'none';

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface Trend {
  mode: TrendMode;
  /** Среднее за последние 7 завершённых дней, а в режиме `norm` — значение свежего дня. */
  current: number | null;
  /** Среднее за 7 дней до них, а в режиме `norm` — личная норма по остальным дням недели. */
  previous: number | null;
  /** Изменение в процентах, целое; null — сравнивать не с чем. */
  percent: number | null;
  /** Настоящее изменение больше потолка: на экране «больше 200 %». */
  capped: boolean;
  /** Сколько дней с данными попало в каждое окно. */
  currentDays: number;
  previousDays: number;
}

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const average = (values: number[]): number | null =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

/** Процент к базе. База слишком мала — процента нет; очень большое изменение упирается в потолок. */
function change(current: number | null, base: number | null): { percent: number | null; capped: boolean } {
  if (current === null || base === null || base < TREND_MIN_BASE) return { percent: null, capped: false };
  const raw = Math.round(((current - base) / base) * 100);
  if (Math.abs(raw) > TREND_MAX_PERCENT) return { percent: Math.sign(raw) * TREND_MAX_PERCENT, capped: true };
  return { percent: raw, capped: false };
}

/**
 * Динамика к прошлой неделе. Основной способ — две недели до `asOf` (сам день не входит):
 * свежая неделя против предыдущей. Пока второй недели нет, сравниваем свежий день недели
 * с личной нормой — средним по остальным дням этой же недели.
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
  const counts = { currentDays: currentWeek.length, previousDays: previousWeek.length };
  const current = average(currentWeek.map((d) => d.value));
  const previous = average(previousWeek.map((d) => d.value));

  if (currentWeek.length >= TREND_MIN_DAYS && previousWeek.length >= TREND_MIN_DAYS) {
    return { mode: 'weeks', current, previous, ...change(current, previous), ...counts };
  }

  // Запасной способ: свежий день недели (сегодняшний тоже) против среднего по остальным дням.
  const week = known(asOf, from(TREND_WINDOW_DAYS - 1));
  if (week.length >= 2) {
    const newest = week[week.length - 1];
    const norm = average(week.slice(0, -1).map((d) => d.value));
    return { mode: 'norm', current: newest.value, previous: norm, ...change(newest.value, norm), ...counts };
  }

  return { mode: 'none', current, previous, percent: null, capped: false, ...counts };
}

/** Подпись под процентом: неделя к неделе или свежий день к личной норме. */
export const trendPhrase = (percent: number, mode: TrendMode = 'weeks'): string => {
  if (mode === 'norm') {
    return percent > 0 ? 'выше вашей нормы' : percent < 0 ? 'ниже вашей нормы' : 'на уровне вашей нормы';
  }
  return percent > 0 ? 'выше прошлой недели' : percent < 0 ? 'ниже прошлой недели' : 'как на прошлой неделе';
};
