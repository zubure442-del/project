import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { nowRingTs } from '../codec';
import { RingBle, handshake, liveMeasure, runSync, type KnownRing, type RingProfile, type SyncStage } from '../ble';
import type { AutoMeasurePeriod } from '../codec';
import type { Report } from '../domain';
import { clearPacketLog } from '../ble';
import {
  EMPTY_STATE,
  addReport,
  buildSnapshots,
  clearState,
  isProfileComplete,
  keepLastDays,
  keepRecentDays,
  loadedDays,
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
import {
  CACHE_FRESH_MS,
  applySync,
  findDay,
  isFresh,
  reportMode,
  reportToShow,
  syncStatusText,
  todayKey,
  weekDays,
} from './day';


/** Старое имя оставлено, чтобы не ломать импорты. */
export const FRESH_MS = CACHE_FRESH_MS;
/** Сегодня и вчера запрашиваем всегда: ночь через полночь кольцо отдаёт двумя днями. */
export const ALWAYS_DAYS = 2;
export const FIRST_PHASE_DAYS = ALWAYS_DAYS;
export const TOTAL_DAYS = 7;
/** Предел первой фазы. Пока идут пакеты, её не прерываем, но бесконечно не ждём. */
export const HARD_CAP_MS = 120000;
/** Если последний замер старше этого, запускаем один живой замер. */
export const GAP_MIN = 90;
/** Живой замер не чаще одного раза в это время. */
export const LIVE_MEASURE_COOLDOWN_MS = 30 * 60 * 1000;

export type Phase = 'idle' | 'first' | 'done' | 'failed' | 'fresh';
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
  setAutoMeasure: (minutes: AutoMeasurePeriod) => void;
  /** Удаляет данные, историю, биометрию и логи. Привязка к кольцу остаётся. */
  clearData: () => void;
  /** Не все дни догрузились: показываем плашку с «Повторить». */
  incomplete: boolean;
}

const Context = createContext<Vuelo | null>(null);

export function useVuelo(): Vuelo {
  const value = useContext(Context);
  if (!value) throw new Error('useVuelo вне VueloProvider');
  return value;
}

/** Календарная дата для смещения в днях назад. */
const dateForOffset = (offset: number, now = new Date()): string =>
  new Date(Date.parse(`${todayKey(now)}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);

const EMPTY_SYNC = {
  steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
  packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
};

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
  const [incomplete, setIncomplete] = useState(false);
  const lastLiveAt = useRef(0);
  const ring = useRef<RingBle | null>(null);
  const running = useRef(false);
  const latest = useRef(EMPTY_STATE);

  useEffect(() => {
    void loadState().then((loaded) => {
      // Автоочистка кэша при запуске: дальше CACHE_DAYS хранить незачем.
      const cleaned = { ...loaded, raw: keepRecentDays(loaded.raw) };
      latest.current = cleaned;
      setState(cleaned);
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

  /** Заряд обновляем независимо от правила свежести: он меняется всё время. */
  const refreshBattery = useCallback(async () => {
    const device = ring.current;
    // Без защиты вызовы накладывались и слали 0x13/0x03/0x0B пачками.
    if (!device || device.status !== 'ready' || running.current) return;
    running.current = true;
    try {
      const off = device.onPacket(() => undefined);
      const result = await runSync(device, { fromDay: 0, days: 0, extras: true });
      off();
      if (result.battery !== null) {
        commit({ ...latest.current, battery: result.battery, batteryAt: Date.now() });
      }
    } catch {
      // Заряд не критичен: молча оставляем прежний.
    } finally {
      running.current = false;
    }
  }, [commit]);

  /**
   * Один живой замер, если кольцо давно ничего не мерило.
   * Работает только при открытом приложении: в фоне iOS такое не разрешает.
   */
  const maybeLiveMeasure = useCallback(
    async (device: RingBle) => {
      const day = findDay(latest.current.days, todayKey());
      const lastMinute = day?.heart.length ? day.heart[day.heart.length - 1].m : null;
      const nowMinute = new Date().getHours() * 60 + new Date().getMinutes();
      const quiet = lastMinute === null || nowMinute - lastMinute >= GAP_MIN;
      if (!quiet || Date.now() - lastLiveAt.current < LIVE_MEASURE_COOLDOWN_MS) return;
      lastLiveAt.current = Date.now();
      try {
        const measured = await liveMeasure(device);
        if (!measured) return;
        const ts = nowRingTs(Date.now(), -new Date().getTimezoneOffset() * 60);
        const source = latest.current;
        const raw = mergeRaw(source.raw, splitByDay({
          ...EMPTY_SYNC,
          heart: [{ ts, value: measured.pulse, raw: [measured.pulse] }],
        }));
        const days = buildSnapshots(toSyncResult(raw), profileAge(source.profile) ?? source.age);
        if (days.length) commit({ ...source, raw, days: keepLastDays(days) });
      } catch {
        // Замер не удался — молчим: кольцо могло быть снято.
      }
    },
    [commit],
  );

  const sync = useCallback(() => {
    if (running.current) return;
    const base = latest.current;
    if (isFresh(base)) {
      setPhase('fresh');
      void refreshBattery();
      return;
    }
    running.current = true;
    void (async () => {
      setError(null);
      setIncomplete(false);
      connectedRef.current = false;
      setConnected(false);
      const startedAt = Date.now();
      setProgress(0);
      setPhase('first');
      const device = ring.current ?? new RingBle(base.ring);
      ring.current = device;
      let known: KnownRing | null = null;
      let firstPhaseOk = false;

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
        // Рукопожатие — один раз на подключение: раньше оно уходило дважды подряд.
        if (device.needsHandshake()) {
          setStage('configuring');
          await handshake(device, toRingProfile(base.profile), base.autoMeasureMin);
          device.markHandshakeDone();
        }

        const bump = () => setPackets((n) => n + 1);
        // Одна фаза: на главный экран пускаем только после полной выгрузки.
        // По ходу интерфейс не трогаем — разбор пакетов и пересчёт заметно лагали.
        const cached = loadedDays(base.raw, todayKey());
        const needed: number[] = [];
        for (let day = 0; day < TOTAL_DAYS; day++) {
          if (day < ALWAYS_DAYS || !cached.has(dateForOffset(day))) needed.push(day);
        }
        const result = await runSync(device, {
          fromDay: needed[0] ?? 0,
          days: needed.length ? needed[needed.length - 1] - needed[0] + 1 : ALWAYS_DAYS,
          extras: true,
          hardCapMs: HARD_CAP_MS,
          onStage: setStage,
          onProgress: advance,
          onPacket: bump,
        });
        store(result);
        firstPhaseOk = latest.current.days.length > 0;
        setIncomplete(Date.now() - startedAt > HARD_CAP_MS);
        setProgress(1);
        setPhase('done');
        void maybeLiveMeasure(device);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Частичная загрузка — не провал: данные за сегодня уже в кэше.
        if (firstPhaseOk) {
          setPhase('done');
        } else {
          setError(connectedRef.current ? 'lost' : message.includes('не отвечает') ? 'slow' : 'not-found');
          commit({ ...latest.current, syncFailed: true });
          setPhase('failed');
        }
      } finally {
        setStage(null);
        running.current = false;
      }
    })();
  }, [advance, commit, maybeLiveMeasure, refreshBattery]);

  // Возврат приложения из фона: приветствие и загрузка, если кэш устарел.
  useEffect(() => {
    const listener = (next: AppStateStatus) => {
      if (next !== 'active' || !latest.current.started) return;
      if (isFresh(latest.current)) {
        void refreshBattery();
        return;
      }
      sync();
    };
    const sub = AppState.addEventListener('change', listener);
    return () => sub.remove();
  }, [refreshBattery, sync]);

  const setAutoMeasure = useCallback(
    (minutes: AutoMeasurePeriod) => commit({ ...latest.current, autoMeasureMin: minutes }),
    [commit],
  );

  const clearData = useCallback(() => {
    void (async () => {
      clearPacketLog();
      const cleared = await clearState();
      // Привязка к кольцу остаётся: её убирает «Забыть кольцо».
      commit({ ...cleared, started: latest.current.started, ring: latest.current.ring });
      setPhase('idle');
    })();
  }, [commit]);

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
      setAutoMeasure,
      clearData,
      incomplete,
    };
  }, [clearData, connected, dismissFresh, error, forgetRing, incomplete, markStarted, packets, phase, progress, ready, saveProfile, setAutoMeasure, stage, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
