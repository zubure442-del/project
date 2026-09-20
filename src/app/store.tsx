import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { RingBle, handshake, runSync } from '../ble';
import type { Report } from '../domain';
import { EMPTY_STATE, addReport, clearState, loadState, saveState, type DaySnapshot, type VueloState } from '../storage';
import { applySync, demoSync, findToday, reportMode, reportToShow, savedReport, syncStatusText, todayKey } from './state';

interface Vuelo {
  state: VueloState;
  today: DaySnapshot | null;
  week: DaySnapshot[];
  report: Report | null;
  busy: boolean;
  progress: string | null;
  statusText: string;
  sync: () => void;
  forgetDemo: () => void;
}

const Context = createContext<Vuelo | null>(null);

export function useVuelo(): Vuelo {
  const value = useContext(Context);
  if (!value) throw new Error('useVuelo вне VueloProvider');
  return value;
}

/** Одно состояние на все вкладки: данные читаются с телефона один раз. */
export function VueloProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VueloState>(EMPTY_STATE);
  const [ring, setRing] = useState<RingBle | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    void loadState().then((loaded) => {
      // Первый запуск: подставляем демо-данные, чтобы экраны не были пустыми.
      if (loaded.days.length || loaded.demoDismissed) {
        setState(loaded);
        return;
      }
      const seeded = applySync({ ...loaded, age: loaded.age ?? 30 }, demoSync(), new Date(), true);
      setState(seeded.state);
      void saveState(seeded.state);
    });
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
    setState(withReport);
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
        const next = applySync(state, result);
        await persist(next.state, next.report);
      } catch (e) {
        Alert.alert('Не вышло', e instanceof Error ? e.message : String(e));
      } finally {
        setProgress(null);
        setBusy(false);
      }
    })();
  }, [busy, persist, ring, state]);

  const forgetDemo = useCallback(() => {
    void clearState(true).then(setState);
  }, []);

  const value = useMemo<Vuelo>(() => {
    const today = findToday(state.days) ?? (state.demo ? (state.days.at(-1) ?? null) : null);
    return {
      state,
      today,
      week: state.days,
      report: reportToShow(state, today) ?? savedReport(state),
      busy,
      progress,
      statusText: syncStatusText(state),
      sync,
      forgetDemo,
    };
  }, [busy, forgetDemo, progress, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
