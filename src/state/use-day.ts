import { useState } from 'react';
import { bannerKind, dayPhrase, dayView, type BannerKind, type DayView } from './day';
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
 * Выбранный день вкладки. По умолчанию — последний полный день; пока сегодня неполный,
 * выбрать его нельзя. Выбор сбрасывается после каждой синхронизации: как только сегодня
 * станет полным, при следующем открытии экран сам переключится на него.
 */
export function useTabDay(): TabDay {
  const { state, syncFailed, profileReady } = useVuelo();
  const view = dayView(state.days);
  const resetKey = state.lastSyncAt ?? 0;
  const [picked, setPicked] = useState<{ date: string; key: number } | null>(null);
  const valid = picked !== null && picked.key === resetKey && !(view.todayLocked && picked.date === view.today);
  const date = valid ? picked.date : view.defaultDate;
  return {
    date,
    select: (next) => setPicked({ date: next, key: resetKey }),
    view,
    banner: bannerKind({ syncFailed, profileReady, todayLocked: view.todayLocked, shownDate: date, today: view.today }),
    shownPhrase: dayPhrase(date, view),
  };
}
