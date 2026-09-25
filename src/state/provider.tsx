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
  clearState,
  isProfileComplete,
  keepRecentDays,
  loadProfile,
  loadState,
  mergeRaw,
  profileAge,
  saveState,
  splitByDay,
  type Profile,
  type VueloState,
} from '../storage';
import { currentCycle } from './cycle';
import { CACHE_FRESH_MS, adviceModeNow, dayView, findDay, isFresh, selectedDay, syncStatusText, todayKey, weekDays, type DayView } from './day';
import { DEMO_STATUS_TEXT, demoState } from './demo';
import { loadPlan, loadProgress, recordDurations, runsInBackground, wantsSlides, type SegmentKind } from './loading';
import { isGoalSet, mergeProfile, withOnboarding } from './profile';
import { settleRelayState } from './relay';
import { AI_ADVICE_SLOT_TEXT, aiAdviceConfig, aiAdviceDue, aiAdviceKey, aiAdviceRequest, fetchAiAdvice, withAiAdvice } from './ai-advice';
import { applySyncResult, newUserTodayOnly, planDays, rebuildDays } from './sync-plan';

/** Старое имя оставлено, чтобы не ломать импорты. */
export const FRESH_MS = CACHE_FRESH_MS;
/** Предел выгрузки. Пока идут пакеты, её не прерываем, но бесконечно не ждём. */
export const HARD_CAP_MS = 120000;
/** Если последний замер старше этого, запускаем один живой замер. */
export const GAP_MIN = 90;
/** Профиль уходит кольцу (0x01 → 0x19 → 0x02) через столько после последней правки. */
export const PROFILE_PUSH_DELAY_MS = 1500;
/** Как часто сверяем дату «сегодня» с часами телефона. */
export const CLOCK_CHECK_MS = 60 * 1000;
/** Живой замер не чаще одного раза в это время. */
export const LIVE_MEASURE_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * idle — ничего не идёт; loading — открыт экран загрузки; done — загрузка кончилась;
 * failed — связь не установилась, на экране загрузки текст ошибки; fresh — данные свежие, к кольцу не идём;
 * background — кэш есть, кольцо догружает сегодня в фоне, экран загрузки не открыт.
 */
export type Phase = 'idle' | 'loading' | 'done' | 'failed' | 'fresh' | 'background';
/** Статус в шапке, пока идёт фоновая догрузка. */
export const BACKGROUND_STATUS_TEXT = 'Обновляем данные…';
/** Три разные беды, о которых говорим по-разному. */
export type SyncError = 'not-found' | 'lost' | 'slow';
/** Откуда запущена синхронизация. Любой запуск идёт через экран загрузки. */
export type SyncMode = 'launch' | 'resume' | 'refresh' | 'retry';

interface Vuelo {
  state: VueloState;
  ready: boolean;
  week: { date: string; day: VueloState['days'][number] | null }[];
  /** Какой день сегодня, заблокирован ли он, последний полный день. */
  dayView: DayView;
  /** Выбранный в календаре день — один на все вкладки. */
  selectedDate: string;
  selectDay: (date: string) => void;
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
  /** Первый запуск: форма со всеми полями отправлена. Bluetooth спрашиваем только после этого. */
  completeOnboarding: (profile: Profile) => void;
  dismissFresh: () => void;
  /** Экран загрузки дошёл до конца (или «Открыть с сохранёнными данными»): закрываем его. */
  finishLoading: () => void;
  /** Правка профиля: только изменённые поля, остальное берётся из актуального состояния. */
  saveProfile: (patch: Partial<Profile>) => void;
  reloadProfile: () => void;
  /** Удаляет данные, историю, профиль и логи. Привязка к кольцу остаётся. */
  clearData: () => void;
  /**
   * Счётчик «открыть главный экран». Растёт, только когда к кольцу сходили и применили новые
   * данные; вкладки следят за ним и переключаются на центральную. Короткое сворачивание
   * приложения и свежий кэш вкладку не меняют. «Сегодня» по этому же счётчику пересоздаёт
   * карусель ассистента, чтобы она открылась на первой карточке.
   */
  homeRequest: number;
  /**
   * Текущий отрезок мнения Лиса («2026-09-25 day»): после пробуждения, днём или перед сном.
   * Меняется, пока приложение открыто, — «Сегодня» перерисовывает совет под новый отрезок.
   */
  adviceSlot: string;
  /** Демо-режим включён: экраны показывают синтетические показатели, посчитанные реальными формулами. */
  demo: boolean;
  /** Включить или выключить демо-режим (меню разработчика). Реальное состояние и хранилище не трогаются. */
  setDemo: (on: boolean) => void;
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
  /** Выбор в календаре. Сбрасывается после выгрузки с экрана загрузки (ключ — счётчик homeRequest). */
  const [picked, setPicked] = useState<{ date: string; key: number } | null>(null);
  /**
   * Сегодняшняя дата по часам телефона. Раньше «сегодня» пересчитывалось только при новых данных:
   * открыл приложение после полуночи со свежим кэшем — и видел вчерашний день.
   */
  const [clockDay, setClockDay] = useState(() => todayKey());
  const lastLiveAt = useRef(0);
  const ring = useRef<RingBle | null>(null);
  const running = useRef(false);
  const latest = useRef(EMPTY_STATE);
  /** Живой замер идёт после загрузки; новая загрузка его прерывает и дожидается. */
  const liveTask = useRef<Promise<void>>(Promise.resolve());
  const stopLive = useRef(false);
  /** Счётчик правок профиля: перечитывание из хранилища не должно откатывать свежую правку. */
  const profileVersion = useRef(0);
  const profilePush = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /**
   * Демо-режим: зерно генератора и момент, на который построены ряды. Только в памяти:
   * после перезапуска приложения демо выключено. `state` и `latest` всегда настоящие.
   */
  const [demo, setDemoSession] = useState<{ seed: number; at: number } | null>(null);
  const demoOn = useRef(false);
  /** Просьба открыть центральную вкладку: только после удачно применённой выгрузки. */
  const [homeRequest, setHomeRequest] = useState(0);
  const goHome = useCallback(() => setHomeRequest((n) => n + 1), []);

  const commit = useCallback((next: VueloState) => {
    latest.current = next;
    setState(next);
    void saveState(next);
  }, []);

  /**
   * «Мнение Лиса» от YandexGPT: после выгрузки, при свежем кэше и при смене отрезка (после
   * пробуждения → днём → перед сном), в фоне, ничего не ждёт и ничего не блокирует.
   * Не вышло (нет сети, посредник не настроен, текст не прошёл проверку) — остаётся шаблонный совет,
   * а тот же отрезок спрашиваем снова не раньше чем через 30 минут (`aiAdviceDue`).
   * Один запрос за раз; совет от модели на цикл и отрезок просим один раз (`aiAdviceRequest`).
   */
  const adviceBusy = useRef(false);
  const adviceTried = useRef(new Map<string, number>());
  const refineAdvice = useCallback(async () => {
    const config = aiAdviceConfig();
    const request = config ? aiAdviceRequest(latest.current) : null;
    if (!config || !request || adviceBusy.current) return;
    const key = aiAdviceKey(request);
    if (!aiAdviceDue(adviceTried.current.get(key))) return;
    adviceTried.current.set(key, Date.now());
    adviceBusy.current = true;
    const slot = AI_ADVICE_SLOT_TEXT[request.mode];
    try {
      const result = await fetchAiAdvice(request.payload, config);
      if ('error' in result) {
        logNote(`мнение Лиса (${slot}) от модели: ${result.error}, остаётся шаблонное`);
        return;
      }
      const next = withAiAdvice(latest.current, request, result.text);
      if (next === latest.current) {
        logNote(`мнение Лиса (${slot}) от модели получено, но пока ждали, совет сменился — не применяем`);
        return;
      }
      commit(next);
      logNote(`мнение Лиса (${slot}) от модели получено`);
    } finally {
      adviceBusy.current = false;
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
        const measured = await liveMeasure(device, undefined, () => stopLive.current);
        if (!measured || stopLive.current) return;
        const ts = nowRingTs(Date.now(), -new Date().getTimezoneOffset() * 60);
        const source = latest.current;
        // Точка добавляется к пульсу дня, а сводки пересобираются тем же расчётом, что после выгрузки.
        // Раньше здесь был свой пересчёт без биометрии: после живого замера пропадали калории.
        const raw = mergeRaw(source.raw, splitByDay({
          ...emptySyncResult(),
          heart: [{ ts, value: measured.pulse, raw: [measured.pulse] }],
        }));
        commit(rebuildDays({ ...source, raw }));
      } catch {
        // Замер не удался — молчим: кольцо могло быть снято.
      }
    },
    [commit],
  );

  /**
   * Единственный путь к кольцу за данными (вход, возврат из фона, pull-to-refresh, «Повторить»).
   * Первый запуск и долгая загрузка идут через экран загрузки; если кэш есть и грузить немного —
   * в фоне, без экрана (`runsInBackground`). По ходу выгрузки состояние не трогаем —
   * оно применяется один раз в конце.
   */
  const sync = useCallback(
    (mode: SyncMode = 'launch') => {
      if (running.current) return;
      // В демо к кольцу не идём: демо работает и без кольца, а настоящие данные ждут выключения.
      if (demoOn.current) return;
      if (isFresh(latest.current)) {
        setPhase('fresh');
        // Кэш свежий, но прошлый запрос совета мог не удаться — пробуем ещё раз.
        void refineAdvice();
        return;
      }
      running.current = true;
      stopLive.current = true;
      setError(null);
      setLoadingMode(mode);
      // План дней известен сразу: от него зависят карточки и ожидаемая длительность частей загрузки.
      // Новый пользователь (полного дня ещё не было) после первой загрузки берёт только сегодня.
      const planAt = new Date();
      const plan = planDays(latest.current.syncedAt, planAt, { todayOnly: newUserTodayOnly(latest.current) });
      const slides = wantsSlides(latest.current.lastSyncAt === null, plan.days.length);
      // Кэш есть и грузить немного — приложение открыто сразу, выгрузка идёт в фоне.
      const background = runsInBackground(latest.current.lastSyncAt === null, plan.days.length, latest.current.days.length > 0);
      const startedAt = Date.now();
      const measured: Partial<Record<SegmentKind, number[]>> = {};
      loadProgress.reset({
        startedAt,
        slides,
        plan: loadPlan(plan.days.length, latest.current.requestDurations),
        segmentStartedAt: startedAt,
      });
      setPhase(background ? 'background' : 'loading');

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
            // В фоне экрана нет: остаётся плашка «Не все данные загружены · Повторить».
            setPhase(background ? 'idle' : connected && next.days.length ? 'done' : 'failed');
            return;
          }

          // Этап 2: запросы по дням.
          measured.connect = [Date.now() - startedAt];
          loadProgress.set({ stage: 2 });
          loadProgress.advance();
          logNote(plan.note);
          let packets = 0;
          const result = await runSync(device, {
            days: plan.days,
            // Та же дата, что у плана: по ней маркер 23:45 сверяется с запрошенным днём.
            today: todayKey(planAt),
            extras: true,
            hardCapMs: HARD_CAP_MS,
            onSegment: (kind, ms, real) => {
              if (real) (measured[kind] ??= []).push(ms);
              loadProgress.advance();
            },
            onPacket: () => loadProgress.set({ packets: ++packets }),
            onNote: logNote,
          });

          // Этап 3: разбор и расчёты.
          loadProgress.set({ stage: 3 });
          await yieldFrame();
          const applied = applySyncResult(latest.current, result, known);
          // Длительности частей удачной загрузки — чтобы в следующий раз процент шёл равномерно.
          const next = result.error
            ? applied
            : { ...applied, requestDurations: recordDurations(applied.requestDurations, measured) };

          // Сверка калорий за сегодня: наш расчёт и число кольца (0x03) — только в отладочный лог.
          const todayCalories = findDay(next.days, todayKey())?.calories ?? null;
          logNote(`калории за сегодня: расчёт ${todayCalories ?? '—'} ккал, кольцо (0x03) ${result.activity?.calories ?? '—'} ккал`);

          // Этап 4: запись кэша, потом одно применение состояния.
          loadProgress.set({ stage: 4 });
          await saveState(next);
          latest.current = next;
          setState(next);
          // Новые данные пришли с экрана загрузки — возвращаемся на «Сегодня» и открываем карусель заново.
          // Фоновая догрузка вкладку, выбранный день и карусель не трогает: человек уже смотрит приложение.
          if (!background) goHome();
          void refineAdvice();
          loadProgress.set({ finished: true, finishedAt: Date.now() });
          if (result.error) {
            setError('lost');
            setPhase(background ? 'idle' : next.days.length ? 'done' : 'failed');
          } else {
            setPhase(background ? 'idle' : 'done');
            liveTask.current = maybeLiveMeasure(device);
          }
        } finally {
          running.current = false;
        }
      })();
    },
    [commit, goHome, maybeLiveMeasure, refineAdvice],
  );

  // Вход в приложение. Самый первый запуск ждёт имя; дальше — правило 10 минут.
  // Загрузка стартует в том же кадре, что и готовность кэша: главный экран не мелькает.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadState().then((loaded) => {
      // Автоочистка кэша при запуске: дальше CACHE_DAYS хранить незачем.
      const kept = { ...loaded, raw: keepRecentDays(loaded.raw) };
      // Кэш до циклов бодрствования: циклы собираются из рядов сразу, не дожидаясь выгрузки.
      // Нагрузка по дням пересоберётся с первой же выгрузкой при запуске.
      const trimmed = kept.cycles.length || !Object.keys(kept.raw).length ? kept : rebuildDays(kept);
      // «Эстафета»: орехи за вчерашние и прошлые дни с нормой — по кэшу, сразу при открытии.
      const cleaned = settleRelayState(trimmed);
      if (cleaned !== trimmed) void saveState(cleaned);
      latest.current = cleaned;
      setState(cleaned);
      setReady(true);
      if (cleaned.started) sync('launch');
    });
  }, [sync]);

  // Возврат из фона: сверяем дату по часам и, если кэш устарел, идём к кольцу (правило 10 минут).
  // Вкладку и выбранный день не трогаем: на «Сегодня» перекидывает только приход новых данных
  // (см. goHome в sync), а выбор из календаря всё равно сбрасывается ключом синхронизации.
  // «active» после шторки или системного окна — не возврат.
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const fromBackground = previous === 'background';
      previous = next;
      if (next !== 'active' || !fromBackground) return;
      setClockDay(todayKey());
      setDemoSession((prev) => prev && { ...prev, at: Date.now() });
      // Возврат из фона — тоже открытие: проверяем кэш на выполненные дни, даже если к кольцу не пойдём.
      if (!running.current) {
        const settled = settleRelayState(latest.current);
        if (settled !== latest.current) commit(settled);
      }
      if (latest.current.started) sync('resume');
    });
    return () => sub.remove();
  }, [commit, sync]);

  // Полночь, пока приложение открыто: дата «сегодня» сменится сама.
  // Смена отрезка мнения Лиса (после пробуждения → днём → перед сном): «Сегодня» перерисуется,
  // и для нового отрезка попросим мнение у модели — без похода к кольцу.
  const [adviceSlot, setAdviceSlot] = useState('');
  const adviceSlotRef = useRef('');
  useEffect(() => {
    const timer = setInterval(() => {
      const day = todayKey();
      setClockDay((prev) => (prev === day ? prev : day));
      // Демо после полуночи строится заново: у нового «сегодня» тоже есть данные.
      setDemoSession((prev) => (prev && todayKey(new Date(prev.at)) !== day ? { ...prev, at: Date.now() } : prev));
      const cycle = currentCycle(latest.current);
      const slot = cycle ? `${cycle.date} ${adviceModeNow(latest.current)}` : '';
      if (slot === adviceSlotRef.current) return;
      const changed = adviceSlotRef.current !== '';
      adviceSlotRef.current = slot;
      setAdviceSlot(slot);
      // Первая проверка после запуска не в счёт: там мнение и так просит выгрузка.
      if (changed && slot && !running.current) void refineAdvice();
    }, CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [refineAdvice]);

  const setDemo = useCallback((on: boolean) => {
    demoOn.current = on;
    setPicked(null);
    // Новое зерно на каждое включение: каждый раз своя правдоподобная неделя.
    setDemoSession(on ? { seed: Date.now() % 2147483647, at: Date.now() } : null);
  }, []);

  const clearData = useCallback(() => {
    void (async () => {
      setDemo(false);
      clearPacketLog();
      const cleared = await clearState();
      // Привязка к кольцу остаётся: её убирает «Забыть кольцо». Дальше — как первый запуск.
      commit({ ...cleared, ring: latest.current.ring });
      setPhase('idle');
    })();
  }, [commit, setDemo]);

  const forgetRing = useCallback(() => {
    void (async () => {
      await ring.current?.disconnect();
      ring.current = null;
      const cleared = await clearState();
      commit({ ...cleared, started: latest.current.started, profile: latest.current.profile });
      setPhase('idle');
    })();
  }, [commit]);

  const completeOnboarding = useCallback(
    (profile: Profile) => {
      void (async () => {
        // Профиль сначала записываем на телефон и ждём записи — только потом Bluetooth и загрузка.
        const next = withOnboarding(latest.current, profile);
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
    const version = profileVersion.current;
    void loadProfile().then((profile) => {
      // Пока читали, профиль успели поправить — прочитанное устарело, не возвращаем его.
      if (version !== profileVersion.current) return;
      if (running.current || JSON.stringify(profile) === JSON.stringify(latest.current.profile)) return;
      latest.current = { ...latest.current, profile };
      setState(latest.current);
    });
  }, []);

  const dismissFresh = useCallback(() => setPhase('idle'), []);
  // Выбор дня живёт до следующей выгрузки с экрана загрузки (счётчик homeRequest); фоновая его не сбрасывает.
  const selectDay = useCallback((date: string) => setPicked({ date, key: homeRequest }), [homeRequest]);
  const finishLoading = useCallback(() => {
    if (!running.current) setPhase('idle');
  }, []);

  const saveProfile = useCallback(
    (patch: Partial<Profile>) => {
      // Правка ложится на актуальный профиль: две правки подряд не затирают друг друга.
      profileVersion.current++;
      const profile = mergeProfile(latest.current.profile, patch);
      // Сводки пересобираем сразу: калории и пульсовые зоны зависят от биометрии.
      const next = rebuildDays({ ...latest.current, profile });
      commit(next);
      // Кольцу профиль нужен сразу, но не на каждую цифру: отправляем, когда правки затихли.
      clearTimeout(profilePush.current);
      profilePush.current = setTimeout(() => {
        const forRing = toRingProfile(latest.current.profile);
        if (forRing && ring.current?.status === 'ready' && !running.current) {
          void handshake(ring.current, forRing).catch(() => undefined);
        }
      }, PROFILE_PUSH_DELAY_MS);
    },
    [commit],
  );

  // Что видят экраны: в демо — синтетические ряды через тот же расчёт, иначе настоящее состояние.
  // Всё, что пишет в хранилище, работает с `latest` (настоящим), а не с этим.
  const shown = useMemo(() => (demo ? demoState(state, demo.seed, new Date(demo.at)) : state), [demo, state]);

  const value = useMemo<Vuelo>(() => {
    // «Сегодня» — от часов телефона (clockDay): при смене даты всё пересчитывается, даже без новых данных.
    const [y, m, d] = clockDay.split('-').map(Number);
    const clock = new Date(y, m - 1, d, 12);
    const view = dayView(shown.days, clock);
    const week = weekDays(shown.days, clock);
    return {
      state: shown,
      ready,
      week,
      dayView: view,
      selectedDate: selectedDay(picked, view, week.map((w) => w.date), homeRequest),
      selectDay,
      phase,
      loadingMode,
      error,
      statusText: demo ? DEMO_STATUS_TEXT : phase === 'background' ? BACKGROUND_STATUS_TEXT : syncStatusText(shown),
      profileReady: isProfileComplete(shown.profile),
      goalReady: isGoalSet(shown.profile),
      syncFailed: shown.syncFailed && shown.started,
      sync,
      forgetRing,
      completeOnboarding,
      dismissFresh,
      finishLoading,
      saveProfile,
      reloadProfile,
      clearData,
      homeRequest,
      adviceSlot,
      demo: demo !== null,
      setDemo,
    };
  }, [adviceSlot, clearData, clockDay, demo, dismissFresh, error, finishLoading, forgetRing, homeRequest, loadingMode, completeOnboarding, phase, picked, ready, reloadProfile, saveProfile, selectDay, setDemo, shown, sync]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
