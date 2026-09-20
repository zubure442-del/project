import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { RingBle, handshake, runSync } from '../ble';
import type { Report } from '../domain';
import { EMPTY_STATE, addReport, loadState, saveState, type DaySnapshot, type VueloState } from '../storage';
import { applySync, demoSync, findToday, reportMode, reportToShow, savedReport, syncStatusText, todayKey, weekDays } from './day';

interface Vuelo {
  state: VueloState;
  today: DaySnapshot | null;
  week: { date: string; day: DaySnapshot | null }[];
  report: Report | null;
  busy: boolean;
  progress: string | null;
  statusText: string;
  sync: () => void;
  /** Переключатель демо-данных в настройках. По умолчанию выключен. */
  setDemo: (on: boolean) => void;
}

const Context = createContext<Vuelo | null>(null);

export function useVuelo(): Vuelo {
  const value = useContext(Context);
  if (!value) throw new Error('useVuelo вне VueloProvider');
  return value;
}

/** Одно состояние на все вкладки: данные читаются с телефона один раз. */
export function VueloProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<VueloState>(EMPTY_STATE);
  /**
   * Демо-режим держим только в памяти: так он не затирает настоящие данные
   * и не остаётся включённым после перезапуска.
   */
  const [demoState, setDemoState] = useState<VueloState | null>(null);
  const state = demoState ?? stored;
  const [ring, setRing] = useState<RingBle | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    void loadState().then(setStored);
  }, []);

  const persist = useCallback(async (next: VueloState, report: Report) => {
    const withReport: VueloState = {
      ...next,
      reports: addReport(next.reports, {
        date: todayKey(),
        mode: reportMode(new Date()),
        templateId: report.templateId,
        text: report.text,
      }),
    };
    setDemoState(null);
    setStored(withReport);
    await saveState(withReport);
  }, []);

  const sync = useCallback(() => {
    if (busy) return;
    void (async () => {
      setBusy(true);
      const device = ring ?? new RingBle();
      if (!ring) setRing(device);
      try {
        device.onStatus = (s) =>
          setProgress(s === 'scanning' ? 'Ищу кольцо…' : s === 'connecting' ? 'Подключаюсь…' : null);
        await device.connect();
        setProgress('Настраиваю кольцо…');
        await handshake(device);
        const result = await runSync(device, { onProgress: (m) => setProgress(`Выгружаю: ${m}`) });
        const next = applySync(stored, result);
        await persist(next.state, next.report);
      } catch (e) {
        Alert.alert('Не вышло', e instanceof Error ? e.message : String(e));
      } finally {
        setProgress(null);
        setBusy(false);
      }
    })();
  }, [busy, persist, ring, stored]);

  const setDemo = useCallback((on: boolean) => {
    setDemoState(on ? applySync({ ...EMPTY_STATE, age: 30 }, demoSync(), new Date(), true).state : null);
  }, []);

  const value = useMemo<Vuelo>(() => {
    const today = findToday(state.days) ?? (state.demo ? (state.days.at(-1) ?? null) : null);
    return {
      state,
      today,
      week: weekDays(state.days),
      report: reportToShow(state, today) ?? savedReport(state),
      busy,
      progress,
      statusText: syncStatusText(state),
      sync,
      setDemo,
    };
  }, [busy, progress, setDemo, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
