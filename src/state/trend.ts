import { weekTrend, type Trend } from '../domain';
import type { VueloState } from '../storage';

/** Какие показатели сравниваем неделя к неделе. */
export type TrendMetric = 'total' | 'sleep' | 'activity' | 'state';

/**
 * Динамика показателя к прошлой неделе относительно выбранного дня:
 * семь завершённых дней до него против семи предыдущих.
 */
export function trendFor(state: VueloState, metric: TrendMetric, asOf: string): Trend {
  return weekTrend(
    state.days.map((d) => ({ date: d.date, value: metric === 'total' ? d.total : d.scores[metric] })),
    asOf,
  );
}
