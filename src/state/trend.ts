import { weekTrend, type Trend } from '../domain';
import type { VueloState } from '../storage';

/** Какие показатели сравниваем неделя к неделе. */
export type TrendMetric = 'total' | 'sleep' | 'activity' | 'state';

/**
 * Динамика показателя по циклам бодрствования: завершённые циклы двух недель, а свежим
 * считается текущий. Показывается только за сегодня: на прошлых датах плавающих индексов нет.
 * Текущий цикл помечен сегодняшней датой, поэтому в недельное сравнение не попадает.
 */
export function trendFor(state: Pick<VueloState, 'cycles'>, metric: TrendMetric, asOf: string): Trend {
  return weekTrend(
    state.cycles.map((c) => ({
      date: c.end === null ? asOf : c.date,
      value: metric === 'total' ? c.total : c.scores[metric],
    })),
    asOf,
  );
}
