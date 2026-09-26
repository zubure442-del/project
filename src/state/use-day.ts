import { tabsOpenFor, todayAnalytics, type TodayAnalytics } from './cycle';
import { bannerKind, dayHasAnything, findDay, type BannerKind, type DayView } from './day';
import { profileAlerts } from './profile';
import { useVuelo } from './provider';

export interface TabDay {
  /** Выбранный день экрана. */
  date: string;
  select: (date: string) => void;
  view: DayView;
  /** Какая плашка видна (одна, по приоритету). */
  banner: BannerKind | null;
  /** Выбран сегодняшний день: аналитика — по текущему циклу бодрствования. */
  isToday: boolean;
  /** Что показывает «Сегодня» по текущему циклу; для прошлых дат — null. */
  today: TodayAnalytics | null;
  /** Сон, Активность и Организм открываются: сегодня — есть что показать по циклу, прошлый день — есть данные. */
  tabsOpen: boolean;
  /** За выбранный день есть хоть какие-то данные. */
  hasData: boolean;
}

/**
 * Выбранный день — общий для всех вкладок, выбирается в календаре в шапке.
 * По умолчанию — сегодня. Выбор сбрасывается после каждой синхронизации.
 * Сегодня аналитика берётся из текущего цикла бодрствования (он может начаться вчера),
 * а календарные счётчики и графики — из сводки дня.
 */
export function useTabDay(): TabDay {
  const { state, syncFailed, dayView: view, selectedDate: date, selectDay } = useVuelo();
  // Плашка биометрии/цели — из той же проверки, что точка на «Профиле» и красные рамки.
  const alerts = profileAlerts(state.profile);
  const isToday = date === view.today;
  const hasData = dayHasAnything(findDay(state.days, date));
  return {
    date,
    select: selectDay,
    view,
    banner: bannerKind({
      syncFailed,
      profileReady: alerts.banner !== 'biometry',
      goalReady: !alerts.missing.has('goal'),
    }),
    isToday,
    today: isToday ? todayAnalytics(state) : null,
    tabsOpen: tabsOpenFor(state, date, view.today, hasData),
    hasData,
  };
}
