import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RingBle, handshake, mergeSyncResults, runSync, type KnownRing, type RingProfile, type SyncStage } from '../ble';
import type { Report } from '../domain';
import {
  EMPTY_STATE,
  addReport,
  buildSnapshots,
  clearState,
  isProfileComplete,
  loadState,
  mergeRaw,
  profileAge,
  saveState,
  splitByDay,
  toSyncResult,
  type DaySnapshot,
  type Profile,
  type VueloState,
} from '../storage';
import { applySync, findDay, reportMode, reportToShow, syncStatusText, todayKey, weekDays } from './day';

/** Если данные свежее пяти минут, к кольцу не идём. */
export const FRESH_MS = 5 * 60 * 1000;
/** Первая фаза: сегодня и вчера — ночь через полночь кольцо отдаёт двумя днями. */
export const FIRST_PHASE_DAYS = 2;
export const TOTAL_DAYS = 7;
/** Предел первой фазы. Пока идут пакеты, её не прерываем, но бесконечно не ждём. */
export const HARD_CAP_MS = 120000;

export type Phase = 'idle' | 'first' | 'background' | 'done' | 'failed' | 'fresh';
/** Три разные беды, о которых говорим по-разному. */
export type SyncError = 'not-found' | 'lost' | 'slow';

interface Vuelo {
  state: VueloState;
  ready: boolean;
  today: DaySnapshot | null;
  week: { date: string; day: DaySnapshot | null }[];
  report: Report | null;
  stage: SyncStage | null;
  phase: Phase;
  progress: number;
  packets: number;
  /** Связь с кольцом установлена: значит «не найдено» показывать нельзя. */
  connected: boolean;
  error: SyncError | null;
  statusText: string;
  profileReady: boolean;
  sync: () => void;
  forgetRing: () => void;
  markStarted: () => void;
  dismissFresh: () => void;
  saveProfile: (profile: Profile) => void;
}

const Context = createContext<Vuelo | null>(null);

export function useVuelo(): Vuelo {
  const value = useContext(Context);
  if (!value) throw new Error('useVuelo вне VueloProvider');
  return value;
}

const toRingProfile = (profile: Profile): RingProfile | null => {
  const age = profileAge(profile);
  if (!isProfileComplete(profile) || age === null) return null;
  return { age, heightCm: profile.heightCm as number, weightKg: profile.weightKg as number, male: profile.sex === 'male' };
};

export function VueloProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VueloState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<SyncStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [packets, setPackets] = useState(0);
  const [connected, setConnected] = useState(false);
  /** Связь могла появиться уже после начала попытки, поэтому дублируем её в ref. */
  const connectedRef = useRef(false);
  const [error, setError] = useState<SyncError | null>(null);
  const ring = useRef<RingBle | null>(null);
  const running = useRef(false);
  const latest = useRef(EMPTY_STATE);

  useEffect(() => {
    void loadState().then((loaded) => {
      latest.current = loaded;
      setState(loaded);
      setReady(true);
    });
  }, []);

  const commit = useCallback((next: VueloState) => {
    latest.current = next;
    setState(next);
    void saveState(next);
  }, []);

  /** Процент только растёт: откат назад выглядел бы как сбой. */
  const advance = useCallback((value: number) => setProgress((p) => Math.max(p, value)), []);

  const sync = useCallback(() => {
    if (running.current) return;
    const base = latest.current;
    if (base.lastSyncAt !== null && !base.syncFailed && Date.now() - base.lastSyncAt < FRESH_MS) {
      setPhase('fresh');
      return;
    }
    running.current = true;
    void (async () => {
      setError(null);
      connectedRef.current = false;
      setConnected(false);
      setProgress(0);
      setPhase('first');
      const device = ring.current ?? new RingBle(base.ring);
      ring.current = device;
      let known: KnownRing | null = null;

      /** Кладёт выгрузку в кэш: ряды дополняются по дню и типу, пустое не затирает. */
      const store = (result: Awaited<ReturnType<typeof runSync>>) => {
        const source = latest.current;
        const raw = mergeRaw(source.raw, splitByDay(result));
        const days = buildSnapshots(toSyncResult(raw, result.battery), profileAge(source.profile) ?? source.age);
        if (!days.length) return;
        const next = applySync({ ...source, raw, ring: known ?? source.ring }, days, result);
        commit({
          ...next.state,
          reports: addReport(next.state.reports, {
            date: todayKey(),
            mode: reportMode(new Date()),
            templateId: next.report.templateId,
            text: next.report.text,
          }),
        });
      };

      try {
        device.onStatus = (s) => setStage(s === 'scanning' || s === 'connecting' ? 'connecting' : null);
        device.onKnown = (k) => {
          known = k;
        };
        setStage('connecting');
        await device.connect();
        connectedRef.current = true;
        setConnected(true);
        setStage('configuring');
        await handshake(device, toRingProfile(base.profile));

        const bump = () => setPackets((n) => n + 1);
        const first = await runSync(device, {
          fromDay: 0,
          days: FIRST_PHASE_DAYS,
          extras: true,
          hardCapMs: HARD_CAP_MS,
          onStage: setStage,
          onProgress: advance,
          onPacket: bump,
        });
        store(first);
        setProgress(1);
        setPhase('background');

        setProgress(0);
        const rest = await runSync(device, {
          fromDay: FIRST_PHASE_DAYS,
          days: TOTAL_DAYS - FIRST_PHASE_DAYS,
          extras: false,
          onProgress: advance,
          onPacket: bump,
        });
        store(mergeSyncResults(first, rest));
        setProgress(1);
        setPhase('done');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(connectedRef.current ? 'lost' : message.includes('не отвечает') ? 'slow' : 'not-found');
        commit({ ...latest.current, syncFailed: true });
        setPhase('failed');
      } finally {
        setStage(null);
        running.current = false;
      }
    })();
  }, [advance, commit]);

  const forgetRing = useCallback(() => {
    void (async () => {
      await ring.current?.disconnect();
      ring.current = null;
      const cleared = await clearState();
      commit({ ...cleared, started: latest.current.started, profile: latest.current.profile });
      setPhase('idle');
    })();
  }, [commit]);

  const markStarted = useCallback(() => commit({ ...latest.current, started: true }), [commit]);
  const dismissFresh = useCallback(() => setPhase('idle'), []);

  const saveProfile = useCallback(
    (profile: Profile) => {
      const next = { ...latest.current, profile };
      commit(next);
      // Кольцу профиль нужен сразу: пульсовые зоны и расход считает оно само.
      const forRing = toRingProfile(profile);
      if (forRing && ring.current?.status === 'ready') void handshake(ring.current, forRing).catch(() => undefined);
    },
    [commit],
  );

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
      connected,
      error,
      statusText: syncStatusText(state),
      profileReady: isProfileComplete(state.profile),
      sync,
      forgetRing,
      markStarted,
      dismissFresh,
      saveProfile,
    };
  }, [connected, dismissFresh, error, forgetRing, markStarted, packets, phase, progress, ready, saveProfile, stage, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
