import { bannerKind, findDay, isCompleteDay, type BannerKind, type DayView } from './day';
import { profileAlerts } from './profile';
import { useVuelo } from './provider';

export interface TabDay {
  /** Выбранный день экрана. */
  date: string;
  select: (date: string) => void;
  view: DayView;
  /** Какая плашка видна (одна, по приоритету). */
  banner: BannerKind | null;
  /** У выбранного дня есть все три метрики. Иначе — экран калибровки и закрытые вкладки. */
  complete: boolean;
}

/**
 * Выбранный день — общий для всех вкладок, выбирается в календаре в шапке.
 * По умолчанию — сегодня. Выбор сбрасывается после каждой синхронизации.
 */
export function useTabDay(): TabDay {
  const { state, syncFailed, dayView: view, selectedDate: date, selectDay } = useVuelo();
  // Плашка биометрии/цели — из той же проверки, что точка на «Профиле» и красные рамки.
  const alerts = profileAlerts(state.profile);
  return {
    date,
    select: selectDay,
    view,
    banner: bannerKind({
      syncFailed,
      profileReady: alerts.banner !== 'biometry',
      goalReady: !alerts.missing.has('goal'),
    }),
    complete: isCompleteDay(findDay(state.days, date)),
  };
}
