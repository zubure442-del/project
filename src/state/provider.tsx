import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { RingBle, handshake, runSync, type KnownRing } from '../ble';
import type { Report } from '../domain';
import {
  EMPTY_STATE,
  addReport,
  buildSnapshots,
  clearState,
  loadState,
  saveState,
  type DaySnapshot,
  type VueloState,
} from '../storage';
import { applySync, findDay, reportMode, reportToShow, syncStatusText, todayKey, weekDays } from './day';

interface Vuelo {
  state: VueloState;
  ready: boolean;
  today: DaySnapshot | null;
  week: { date: string; day: DaySnapshot | null }[];
  report: Report | null;
  busy: boolean;
  progress: string | null;
  statusText: string;
  sync: () => void;
  forgetRing: () => void;
  finishOnboarding: () => void;
  dayAt: (date: string) => DaySnapshot | null;
}

const Context = createContext<Vuelo | null>(null);

export function useVuelo(): Vuelo {
  const value = useContext(Context);
  if (!value) throw new Error('useVuelo вне VueloProvider');
  return value;
}

export function VueloProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VueloState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [ring, setRing] = useState<RingBle | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Кэш показываем сразу, не дожидаясь кольца.
  useEffect(() => {
    void loadState().then((loaded) => {
      setState(loaded);
      setReady(true);
    });
  }, []);

  const sync = useCallback(() => {
    if (busy) return;
    void (async () => {
      setBusy(true);
      const device = ring ?? new RingBle(state.ring);
      if (!ring) setRing(device);
      let known: KnownRing | null = null;
      try {
        device.onStatus = (s) =>
          setProgress(s === 'scanning' ? 'Ищу кольцо' : s === 'connecting' ? 'Подключаюсь' : null);
        device.onKnown = (k) => {
          known = k;
        };
        await device.connect();
        setProgress('Настраиваю кольцо');
        await handshake(device);
        const result = await runSync(device, { onProgress: setProgress });
        const days = buildSnapshots(result, state.age);
        // Пустая выгрузка кэш не трогает: лучше показать вчерашние данные, чем пустой экран.
        if (!days.length) {
          Alert.alert('Кольцо не отдало данные', 'Попробуйте ещё раз через минуту.');
          return;
        }
        const next = applySync({ ...state, ring: known ?? state.ring }, days, result);
        const withReport: VueloState = {
          ...next.state,
          reports: addReport(next.state.reports, {
            date: todayKey(),
            mode: reportMode(new Date()),
            templateId: next.report.templateId,
            text: next.report.text,
          }),
        };
        setState(withReport);
        await saveState(withReport);
      } catch (e) {
        Alert.alert('Не вышло', e instanceof Error ? e.message : String(e));
      } finally {
        setProgress(null);
        setBusy(false);
      }
    })();
  }, [busy, ring, state]);

  const forgetRing = useCallback(() => {
    void (async () => {
      await ring?.disconnect();
      setRing(null);
      const next = await clearState();
      setState({ ...next, onboarded: state.onboarded });
      await saveState({ ...next, onboarded: state.onboarded });
    })();
  }, [ring, state.onboarded]);

  const finishOnboarding = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, onboarded: true };
      void saveState(next);
      return next;
    });
  }, []);

  const value = useMemo<Vuelo>(() => {
    const today = findDay(state.days, todayKey());
    return {
      state,
      ready,
      today,
      week: weekDays(state.days),
      report: reportToShow(state, today),
      busy,
      progress,
      statusText: syncStatusText(state),
      sync,
      forgetRing,
      finishOnboarding,
      dayAt: (date: string) => findDay(state.days, date),
    };
  }, [busy, finishOnboarding, forgetRing, progress, ready, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
