import type { DaySnapshot } from '../storage';

/** День считается непустым, если есть сон или заметное число шагов. */
export const MIN_STEPS_FOR_DAY = 500;
/** Пока дней мало, точки не растягиваем на всю ширину, а держим в центре. */
export const MAX_DAY_SPACING = 56;

export const hasData = (day: DaySnapshot | null): day is DaySnapshot =>
  !!day && (day.sleep !== null || (day.steps ?? 0) >= MIN_STEPS_FOR_DAY);

/**
 * Что показывать в неделе: от первого дня с данными до сегодня.
 * Дни до первого замера не рисуем — у нового пользователя не должно быть пустого поля,
 * а пропуски внутри интервала остаются, чтобы разрыв в данных был виден.
 */
export function visibleDays<T extends { date: string; day: DaySnapshot | null }>(days: T[], keep?: string | null): T[] {
  const first = days.findIndex((d) => hasData(d.day));
  if (first < 0) return [];
  // Хвостовые дни без данных тоже не рисуем: пустой «Пн» справа выглядит как провал.
  let last = days.length - 1;
  while (last > first && !hasData(days[last].day)) last--;
  // Заблокированный сегодняшний день показываем всегда: на нём замок.
  const kept = keep ? days.findIndex((d) => d.date === keep) : -1;
  return days.slice(first, Math.max(last, kept) + 1);
}
