import type { DaySnapshot } from '../storage';

/** День считается непустым, если есть сон или заметное число шагов. */
export const MIN_STEPS_FOR_DAY = 500;
/** Пока дней мало, точки не растягиваем на всю ширину, а держим в центре. */
export const MAX_DAY_SPACING = 56;
/** Чип динамики показываем, только когда есть чем усреднять. */
export const MIN_DAYS_FOR_TREND = 3;

export const hasData = (day: DaySnapshot | null): day is DaySnapshot =>
  !!day && (day.sleep !== null || (day.steps ?? 0) >= MIN_STEPS_FOR_DAY);

/**
 * Что показывать в неделе: от первого дня с данными до сегодня.
 * Дни до первого замера не рисуем — у нового пользователя не должно быть пустого поля,
 * а пропуски внутри интервала остаются, чтобы разрыв в данных был виден.
 */
export function visibleDays<T extends { date: string; day: DaySnapshot | null }>(days: T[]): T[] {
  const first = days.findIndex((d) => hasData(d.day));
  return first < 0 ? [] : days.slice(first);
}
