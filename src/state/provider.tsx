import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { nowRingTs } from '../codec';
import {
  RingBle,
  clearPacketLog,
  emptySyncResult,
  handshake,
  liveMeasure,
  logNote,
  runSync,
  type KnownRing,
  type RingProfile,
} from '../ble';
import {
  EMPTY_STATE,
  buildSnapshots,
  clearState,
  isProfileComplete,
  keepLastDays,
  keepRecentDays,
  loadProfile,
  loadState,
  mergeRaw,
  profileAge,
  saveState,
  splitByDay,
  toSyncResult,
  type Profile,
  type VueloState,
} from '../storage';
import { CACHE_FRESH_MS, findDay, isFresh, syncStatusText, todayKey, weekDays } from './day';
import { SLIDES_MIN_DAYS, loadProgress, recordDuration, slideInterval } from './loading';
import { isGoalSet, withStartName } from './profile';
import { applySyncResult, planDays } from './sync-plan';

/** Старое имя оставлено, чтобы не ломать импорты. */
export const FRESH_MS = CACHE_FRESH_MS;
/** Предел выгрузки. Пока идут пакеты, её не прерываем, но бесконечно не ждём. */
export const HARD_CAP_MS = 120000;
/** Если последний замер старше этого, запускаем один живой замер. */
export const GAP_MIN = 90;
/** Живой замер не чаще одного раза в это время. */
export const LIVE_MEASURE_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * idle — ничего не идёт; loading — открыт экран загрузки; done — загрузка кончилась;
 * failed — связь не установилась, на экране загрузки текст ошибки; fresh — данные свежие, к кольцу не идём.
 */
export type Phase = 'idle' | 'loading' | 'done' | 'failed' | 'fresh';
/** Три разные беды, о которых говорим по-разному. */
export type SyncError = 'not-found' | 'lost' | 'slow';
/** Откуда запущена синхронизация. Любой запуск идёт через экран загрузки. */
export type SyncMode = 'launch' | 'resume' | 'refresh' | 'retry';

interface Vuelo {
  state: VueloState;
  ready: boolean;
  week: { date: string; day: VueloState['days'][number] | null }[];
  phase: Phase;
  /** Откуда запущена загрузка: от этого заголовок («Обновляем данные» на pull-to-refresh) и появление. */
  loadingMode: SyncMode;
  error: SyncError | null;
  statusText: string;
  /** Биометрия заполнена (пол, рост, вес, год рождения). */
  profileReady: boolean;
  /** Цель выбрана. */
  goalReady: boolean;
  /** Последняя синхронизация закончилась ошибкой связи: плашка «Не все данные загружены». */
  syncFailed: boolean;
  sync: (mode?: SyncMode) => void;
  forgetRing: () => void;
  /** Первый запуск: имя (или null — «Пропустить») и старт. Bluetooth спрашиваем только после этого. */
  markStarted: (name: string | null) => void;
  dismissFresh: () => void;
  /** Экран загрузки дошёл до конца (или «Открыть с сохранёнными данными»): закрываем его. */
  finishLoading: () => void;
  saveProfile: (profile: Profile) => void;
  reloadProfile: () => void;
  /** Удаляет данные, историю, профиль и логи. Привязка к кольцу остаётся. */
  clearData: () => void;
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

/** Дать экрану загрузки отрисовать новый этап перед тяжёлым расчётом. */
const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

export function VueloProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VueloState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [loadingMode, setLoadingMode] = useState<SyncMode>('launch');
  const [error, setError] = useState<SyncError | null>(null);
  const lastLiveAt = useRef(0);
  const ring = useRef<RingBle | null>(null);
  const running = useRef(false);
  const latest = useRef(EMPTY_STATE);
  /** Живой замер идёт после загрузки; новая загрузка его прерывает и дожидается. */
  const liveTask = useRef<Promise<void>>(Promise.resolve());
  const stopLive = useRef(false);

  const commit = useCallback((next: VueloState) => {
    latest.current = next;
    setState(next);
    void saveState(next);
  }, []);

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
        const measured = await liveMeasure(device, undefined, () => stopLive.current);
        if (!measured || stopLive.current) return;
        const ts = nowRingTs(Date.now(), -new Date().getTimezoneOffset() * 60);
        const source = latest.current;
        const raw = mergeRaw(source.raw, splitByDay({
          ...emptySyncResult(),
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

  /**
   * Единственный путь к кольцу за данными. Любой запуск (вход, возврат из фона,
   * pull-to-refresh, «Повторить») открывает экран загрузки; по ходу выгрузки
   * состояние не трогаем — оно применяется один раз в конце.
   */
  const sync = useCallback(
    (mode: SyncMode = 'launch') => {
      if (running.current) return;
      if (isFresh(latest.current)) {
        setPhase('fresh');
        return;
      }
      running.current = true;
      stopLive.current = true;
      setError(null);
      setLoadingMode(mode);
      // План дней известен сразу: от него зависит, показывать ли карточки с рисунками.
      const plan = planDays(latest.current.syncedAt);
      const slides = plan.days.length >= SLIDES_MIN_DAYS;
      const startedAt = Date.now();
      loadProgress.reset({ startedAt, slides, intervalMs: slideInterval(latest.current.syncDurations.long) });
      setPhase('loading');

      void (async () => {
        await liveTask.current;
        stopLive.current = false;
        const base = latest.current;
        const device = ring.current ?? new RingBle(base.ring);
        ring.current = device;
        let known: KnownRing | null = null;
        device.onKnown = (k) => {
          known = k;
        };
        device.onStatus = () => undefined;
        let connected = false;
        try {
          // Этап 1: поиск, соединение, рукопожатие.
          try {
            await device.connect();
            connected = true;
            // Рукопожатие — один раз на подключение, порядок 0x01 → 0x19 → 0x02.
            if (device.needsHandshake()) {
              await handshake(device, toRingProfile(base.profile), base.autoMeasureMin);
              device.markHandshakeDone();
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            logNote(`нет связи: ${message}`);
            const kind: SyncError = connected ? 'lost' : message.includes('не отвечает') ? 'slow' : 'not-found';
            const next = { ...latest.current, syncFailed: true };
            commit(next);
            setError(kind);
            loadProgress.set({ finished: true, finishedAt: Date.now() });
            // Экран ошибки — только если связи не было вовсе или показывать нечего.
            setPhase(connected && next.days.length ? 'done' : 'failed');
            return;
          }

          // Этап 2: запросы по дням.
          loadProgress.set({ stage: 2 });
          logNote(plan.note);
          let packets = 0;
          const result = await runSync(device, {
            days: plan.days,
            extras: true,
            hardCapMs: HARD_CAP_MS,
            onProgress: (fraction) => loadProgress.set({ fraction }),
            onPacket: () => loadProgress.set({ packets: ++packets }),
            onNote: logNote,
          });

          // Этап 3: разбор и расчёты.
          loadProgress.set({ stage: 3 });
          await yieldFrame();
          const applied = applySyncResult(latest.current, result, known);
          // Длительность удачной загрузки — для интервала карточек в следующий раз.
          const next = result.error
            ? applied
            : {
                ...applied,
                syncDurations: {
                  ...applied.syncDurations,
                  [slides ? 'long' : 'short']: recordDuration(
                    applied.syncDurations[slides ? 'long' : 'short'],
                    Date.now() - startedAt,
                  ),
                },
              };

          // Этап 4: запись кэша, потом одно применение состояния.
          loadProgress.set({ stage: 4 });
          await saveState(next);
          latest.current = next;
          setState(next);
          loadProgress.set({ finished: true, finishedAt: Date.now() });
          if (result.error) {
            setError('lost');
            setPhase(next.days.length ? 'done' : 'failed');
          } else {
            setPhase('done');
            liveTask.current = maybeLiveMeasure(device);
          }
        } finally {
          running.current = false;
        }
      })();
    },
    [commit, maybeLiveMeasure],
  );

  // Вход в приложение. Самый первый запуск ждёт имя; дальше — правило 10 минут.
  // Загрузка стартует в том же кадре, что и готовность кэша: главный экран не мелькает.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadState().then((loaded) => {
      // Автоочистка кэша при запуске: дальше CACHE_DAYS хранить незачем.
      const cleaned = { ...loaded, raw: keepRecentDays(loaded.raw) };
      latest.current = cleaned;
      setState(cleaned);
      setReady(true);
      if (cleaned.started) sync('launch');
    });
  }, [sync]);

  // Возврат из фона: правило 10 минут. «active» после шторки или системного окна — не возврат.
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const fromBackground = previous === 'background';
      previous = next;
      if (next === 'active' && fromBackground && latest.current.started) sync('resume');
    });
    return () => sub.remove();
  }, [sync]);

  const clearData = useCallback(() => {
    void (async () => {
      clearPacketLog();
      const cleared = await clearState();
      // Привязка к кольцу остаётся: её убирает «Забыть кольцо». Дальше — как первый запуск.
      commit({ ...cleared, ring: latest.current.ring });
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

  const markStarted = useCallback(
    (name: string | null) => {
      void (async () => {
        // Имя сначала записываем на телефон и ждём записи — только потом Bluetooth и загрузка.
        const next = withStartName(latest.current, name);
        await saveState(next);
        latest.current = next;
        setState(next);
        sync('launch');
      })();
    },
    [sync],
  );

  /** «Профиль» при открытии перечитывает профиль из хранилища. */
  const reloadProfile = useCallback(() => {
    void loadProfile().then((profile) => {
      if (running.current || JSON.stringify(profile) === JSON.stringify(latest.current.profile)) return;
      latest.current = { ...latest.current, profile };
      setState(latest.current);
    });
  }, []);

  const dismissFresh = useCallback(() => setPhase('idle'), []);
  const finishLoading = useCallback(() => {
    if (!running.current) setPhase('idle');
  }, []);

  const saveProfile = useCallback(
    (profile: Profile) => {
      const next = { ...latest.current, profile };
      commit(next);
      // Кольцу профиль нужен сразу: пульсовые зоны и расход считает оно само.
      const forRing = toRingProfile(profile);
      if (forRing && ring.current?.status === 'ready' && !running.current) {
        void handshake(ring.current, forRing).catch(() => undefined);
      }
    },
    [commit],
  );

  const value = useMemo<Vuelo>(() => {
    return {
      state,
      ready,
      week: weekDays(state.days),
      phase,
      loadingMode,
      error,
      statusText: syncStatusText(state),
      profileReady: isProfileComplete(state.profile),
      goalReady: isGoalSet(state.profile),
      syncFailed: state.syncFailed && state.started,
      sync,
      forgetRing,
      markStarted,
      dismissFresh,
      finishLoading,
      saveProfile,
      reloadProfile,
      clearData,
    };
  }, [clearData, dismissFresh, error, finishLoading, forgetRing, loadingMode, markStarted, phase, ready, reloadProfile, saveProfile, state, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
