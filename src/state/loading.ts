/**
 * Этапы экрана загрузки. Каждый привязан к реальному событию:
 * 1 — поиск, соединение, рукопожатие; 2 — запросы по дням;
 * 3 — разбор и расчёты; 4 — запись кэша и переход.
 */
export type LoadStage = 1 | 2 | 3 | 4;
export const STAGE_COUNT = 4;

/** Каждый этап на экране висит хотя бы столько, пока загрузка идёт. */
export const STAGE_MIN_MS = 2500;
/** Когда загрузка уже кончилась, оставшиеся этапы пролетают с этой паузой: экран не держим дольше нужного. */
export const STAGE_TAIL_MS = 700;
/** Смена карточки и рисунка — затухание. */
export const STAGE_FADE_MS = 200;

/** Доля общего процента на каждый этап: основное время уходит на запросы. */
export const STAGE_BANDS: Record<LoadStage, [number, number]> = {
  1: [0, 0.1],
  2: [0.1, 0.9],
  3: [0.9, 0.95],
  4: [0.95, 1],
};

/** Реальный ход загрузки. Живёт вне React-состояния, чтобы вкладки не перерисовывались по пакетам. */
export interface LoadProgress {
  stage: LoadStage;
  /** Доля выполненных запросов внутри этапа 2, 0..1. */
  fraction: number;
  packets: number;
  /** Загрузка закончилась (успешно или нет). */
  finished: boolean;
}

export const INITIAL_PROGRESS: LoadProgress = { stage: 1, fraction: 0, packets: 0, finished: false };

/** Общий процент по реальному ходу загрузки. */
export function realPercent(p: LoadProgress): number {
  if (p.finished) return 1;
  const [from, to] = STAGE_BANDS[p.stage];
  const inside = p.stage === 2 ? Math.min(1, Math.max(0, p.fraction)) : 0;
  return from + (to - from) * inside;
}

export interface ShownStage {
  stage: LoadStage;
  /** Когда этап появился на экране. */
  since: number;
}

/**
 * Какой этап показать сейчас. Показанный этап не обгоняет реальный и держится
 * не меньше STAGE_MIN_MS; после конца загрузки — не меньше STAGE_TAIL_MS.
 */
export function nextShownStage(shown: ShownStage, real: LoadProgress, now: number): ShownStage {
  const target = real.finished ? STAGE_COUNT : real.stage;
  if (shown.stage >= target) return shown;
  const hold = real.finished ? STAGE_TAIL_MS : STAGE_MIN_MS;
  if (now - shown.since < hold) return shown;
  return { stage: (shown.stage + 1) as LoadStage, since: now };
}

/** Экран можно закрывать: загрузка кончилась и последний этап показан положенное время. */
export const canLeave = (shown: ShownStage, real: LoadProgress, now: number) =>
  real.finished && shown.stage === STAGE_COUNT && now - shown.since >= STAGE_TAIL_MS;

/** Процент на кольце: не больше верхней границы показанного этапа и только растёт. */
export const shownPercent = (previous: number, shown: ShownStage, real: LoadProgress) =>
  Math.max(previous, Math.min(realPercent(real), STAGE_BANDS[shown.stage][1]));

/** Простой наблюдаемый контейнер: экран загрузки подписывается, остальные экраны — нет. */
export function createProgressStore() {
  let value = INITIAL_PROGRESS;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch: Partial<LoadProgress>) {
      value = { ...value, ...patch };
      listeners.forEach((l) => l());
    },
    reset() {
      value = INITIAL_PROGRESS;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const loadProgress = createProgressStore();
