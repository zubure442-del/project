import { bannerKind, dayPhrase, type BannerKind, type DayView } from './day';
import { profileAlerts } from './profile';
import { useVuelo } from './provider';

export interface TabDay {
  /** Выбранный день экрана. */
  date: string;
  select: (date: string) => void;
  view: DayView;
  /** Какая плашка видна (одна, по приоритету). */
  banner: BannerKind | null;
  /** «вчерашний день» или «18 сентября» — для плашки «показан …». */
  shownPhrase: string;
}

/**
 * Выбранный день — общий для всех вкладок, выбирается в календаре в шапке.
 * По умолчанию — последний полный день; пока сегодня неполный, выбрать его нельзя.
 * Выбор сбрасывается после каждой синхронизации: полный сегодня откроется сам.
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
      todayLocked: view.todayLocked,
      shownDate: date,
      today: view.today,
    }),
    shownPhrase: dayPhrase(date, view),
  };
}
