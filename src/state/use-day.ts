import { useEffect, useRef, useState } from 'react';
import type { DaySnapshot } from '../storage';
import { dayHasAnything, defaultDay, findDay, todayKey } from './day';

/**
 * Выбранный день экрана. Пока за сегодня пусто, открывается последний день с данными;
 * как только данные за сегодня приходят, экран сам переключается на сегодня.
 */
export function useSelectedDay(days: DaySnapshot[]): [string, (date: string) => void] {
  const [picked, setPicked] = useState<string | null>(null);
  const jumped = useRef(false);
  const today = todayKey();
  const todayReady = dayHasAnything(findDay(days, today));

  useEffect(() => {
    if (todayReady && !jumped.current) {
      jumped.current = true;
      setPicked(today);
    }
  }, [today, todayReady]);

  return [picked ?? defaultDay(days), setPicked];
}
