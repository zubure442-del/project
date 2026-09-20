import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RingBle, handshake, mergeSyncResults, runSync, type KnownRing, type SyncStage } from '../ble';
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

/** Если данные свежее пяти минут, к кольцу не идём. */
export const FRESH_MS = 5 * 60 * 1000;
/** Первая фаза: сегодня и вчера. Ночь через полночь кольцо отдаёт двумя днями. */
export const FIRST_PHASE_DAYS = 2;
export const TOTAL_DAYS = 7;

export type Phase = 'idle' | 'first' | 'background' | 'done' | 'failed' | 'fresh';

interface Vuelo {
  state: VueloState;
  ready: boolean;
  today: DaySnapshot | null;
  week: { date: string; day: DaySnapshot | null }[];
  report: Report | null;
  /** Этап связи для экрана приветствия. */
  stage: SyncStage | null;
  phase: Phase;
  /** Доля текущей фазы, 0..1. Только растёт. */
  progress: number;
  /** Счётчик пришедших пакетов — для блика на дуге. */
  packets: number;
  error: string | null;
  statusText: string;
  sync: () => void;
  forgetRing: () => void;
  markStarted: () => void;
  dismissFresh: () => void;
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<SyncStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [packets, setPackets] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ring = useRef<RingBle | null>(null);
  const running = useRef(false);

  useEffect(() => {
    void loadState().then((loaded) => {
      setState(loaded);
      setReady(true);
    });
  }, []);

  /** Процент только растёт: откат назад выглядел бы как сбой. */
  const advance = useCallback((value: number) => setProgress((p) => Math.max(p, value)), []);

  const sync = useCallback(() => {
    if (running.current) return;
    if (state.lastSyncAt !== null && Date.now() - state.lastSyncAt < FRESH_MS) {
      setPhase('fresh');
      return;
    }
    running.current = true;
    void (async () => {
      setError(null);
      setProgress(0);
      setPhase('first');
      const device = ring.current ?? new RingBle(state.ring);
      ring.current = device;
      let known: KnownRing | null = null;
      try {
        device.onStatus = (s) => setStage(s === 'scanning' || s === 'connecting' ? 'connecting' : null);
        device.onKnown = (k) => {
          known = k;
        };
        setStage('connecting');
        await device.connect();
        setStage('configuring');
        await handshake(device);

        const bump = () => setPackets((n) => n + 1);
        const first = await runSync(device, {
          fromDay: 0,
          days: FIRST_PHASE_DAYS,
          extras: false,
          onStage: setStage,
          onProgress: advance,
          onPacket: bump,
        });
        const afterFirst = await commit(first, known);
        setProgress(1);
        setPhase('background');

        setProgress(0);
        const rest = await runSync(device, {
          fromDay: FIRST_PHASE_DAYS,
          days: TOTAL_DAYS - FIRST_PHASE_DAYS,
          onProgress: advance,
          onPacket: bump,
        });
        await commit(mergeSyncResults(first, rest), known, afterFirst);
        setProgress(1);
        setPhase('done');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('failed');
      } finally {
        setStage(null);
        running.current = false;
      }
    })();

    /** Кладём выгрузку в кэш. Пустая выгрузка кэш не трогает. */
    async function commit(result: Awaited<ReturnType<typeof runSync>>, known: KnownRing | null, base?: VueloState) {
      const source = base ?? state;
      const days = buildSnapshots(result, source.age);
      if (!days.length) return source;
      const next = applySync({ ...source, ring: known ?? source.ring }, days, result);
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
      return withReport;
    }
  }, [advance, state]);

  const forgetRing = useCallback(() => {
    void (async () => {
      await ring.current?.disconnect();
      ring.current = null;
      const cleared = { ...(await clearState()), started: state.started };
      setState(cleared);
      setPhase('idle');
      await saveState(cleared);
    })();
  }, [state.started]);

  const markStarted = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, started: true };
      void saveState(next);
      return next;
    });
  }, []);

  const dismissFresh = useCallback(() => setPhase('idle'), []);

  const value = useMemo<Vuelo>(() => {
    const today = findDay(state.days, todayKey());
    return {
      state,
      ready,
      today,
      week: weekDays(state.days),
      report: reportToShow(state, today),
      stage,
      phase,
      progress,
      packets,
      error,
      statusText: syncStatusText(state),
      sync,
      forgetRing,
      markStarted,
      dismissFresh,
    };
  }, [dismissFresh, error, forgetRing, markStarted, packets, phase, progress, ready, stage, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
