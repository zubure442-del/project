/**
 * Реальные этапы загрузки: 1 — поиск, соединение, рукопожатие; 2 — запросы по дням;
 * 3 — разбор и расчёты; 4 — запись кэша. От них зависят кольцо-прогресс и строка статуса.
 * Карточки с рисунками от этапов НЕ зависят: они листаются равными интервалами.
 */
export type LoadStage = 1 | 2 | 3 | 4;

/** Сколько карточек с рисунками. */
export const SLIDE_COUNT = 4;
/** Карточки показываем, только если предстоит загрузить столько дней или больше (первый запуск, после очистки). */
export const SLIDES_MIN_DAYS = 3;
/** Ожидаемая длительность загрузки, пока своей истории нет. */
export const DEFAULT_EXPECTED_MS = 40000;
/** Интервал карточки — четверть ожидаемой длительности, но в этих пределах. */
export const SLIDE_MIN_MS = 4000;
export const SLIDE_MAX_MS = 12000;
/** По скольким последним удачным загрузкам берём медиану. */
export const DURATION_HISTORY = 3;
/** Загрузка кончилась раньше карточек: текущая держится ещё не дольше этого и идёт переход. */
export const FINISH_HOLD_MS = 2500;
/** Быстрый экран без карточек: после конца загрузки ещё столько, и всего не меньше QUICK_MIN_MS. */
export const QUICK_HOLD_MS = 400;
export const QUICK_MIN_MS = 1200;
/** Смена карточки и рисунка — затухание. */
export const STAGE_FADE_MS = 200;

/** Доля общего процента на каждый этап: основное время уходит на запросы. */
export const STAGE_BANDS: Record<LoadStage, [number, number]> = {
  1: [0, 0.1],
  2: [0.1, 0.9],
  3: [0.9, 0.95],
  4: [0.95, 1],
};

/** Ход загрузки. Живёт вне React-состояния, чтобы вкладки не перерисовывались по пакетам. */
export interface LoadProgress {
  stage: LoadStage;
  /** Доля выполненных запросов внутри этапа 2, 0..1. */
  fraction: number;
  packets: number;
  /** Загрузка закончилась (успешно или нет). */
  finished: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** Длинная загрузка: показываем карточки с рисунками. Иначе — быстрый экран. */
  slides: boolean;
  /** Интервал листания карточек. */
  intervalMs: number;
}

export const INITIAL_PROGRESS: LoadProgress = {
  stage: 1,
  fraction: 0,
  packets: 0,
  finished: false,
  startedAt: 0,
  finishedAt: null,
  slides: false,
  intervalMs: DEFAULT_EXPECTED_MS / SLIDE_COUNT,
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Ожидаемая длительность: медиана последних удачных загрузок того же типа. */
export function expectedDuration(history: readonly number[]): number {
  const recent = history.slice(-DURATION_HISTORY);
  return recent.length ? median(recent) : DEFAULT_EXPECTED_MS;
}

/** Интервал карточки: I = clamp(T / 4, 4 с, 12 с). */
export const slideInterval = (history: readonly number[]) =>
  Math.min(SLIDE_MAX_MS, Math.max(SLIDE_MIN_MS, expectedDuration(history) / SLIDE_COUNT));

/** Новая длительность в историю: храним только последние DURATION_HISTORY. */
export const recordDuration = (history: readonly number[], ms: number) => [...history, ms].slice(-DURATION_HISTORY);

/** Какая карточка сейчас (1..4). После четвёртой остаётся она. */
export const slideAt = (elapsed: number, interval: number) =>
  Math.min(SLIDE_COUNT, Math.floor(Math.max(0, elapsed) / interval) + 1);

/** Номер карточки на экране: после конца загрузки листание останавливается. */
export function currentSlide(p: LoadProgress, now: number): number {
  const at = p.finished && p.finishedAt !== null ? Math.min(now, p.finishedAt) : now;
  return slideAt(at - p.startedAt, p.intervalMs);
}

/** Подпись под кольцом: «Шаг N из 4» или «Почти готово», если загрузка дольше всех карточек. */
export function slideCaption(p: LoadProgress, now: number): string {
  const late = !p.finished && now - p.startedAt >= SLIDE_COUNT * p.intervalMs;
  return late ? 'Почти готово' : `Шаг ${currentSlide(p, now)} из ${SLIDE_COUNT}`;
}

/** Когда уходить на главный экран; null — загрузка ещё идёт. */
export function leaveAt(p: LoadProgress): number | null {
  if (!p.finished || p.finishedAt === null) return null;
  if (!p.slides) return Math.max(p.finishedAt + QUICK_HOLD_MS, p.startedAt + QUICK_MIN_MS);
  const slide = slideAt(p.finishedAt - p.startedAt, p.intervalMs);
  const cardEnd = slide < SLIDE_COUNT ? p.startedAt + slide * p.intervalMs : Infinity;
  return p.finishedAt + Math.min(FINISH_HOLD_MS, Math.max(0, cardEnd - p.finishedAt));
}

/** Общий процент по реальному ходу загрузки. */
export function realPercent(p: LoadProgress): number {
  if (p.finished) return 1;
  const [from, to] = STAGE_BANDS[p.stage];
  const inside = p.stage === 2 ? Math.min(1, Math.max(0, p.fraction)) : 0;
  return from + (to - from) * inside;
}

/** Настоящий статус: что сейчас делаем и сколько процентов. */
export function statusText(p: LoadProgress, percent: number): string {
  if (p.stage === 1 && !p.finished) return 'Подключаемся…';
  return `Загружаем данные · ${Math.round(percent * 100)} %`;
}

/** Простой наблюдаемый контейнер: экран загрузки подписывается, остальные экраны — нет. */
export function createProgressStore() {
  let value = INITIAL_PROGRESS;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => value,
    set(patch: Partial<LoadProgress>) {
      value = { ...value, ...patch };
      emit();
    },
    /** Начало новой загрузки: время старта, вид экрана и интервал карточек. */
    reset(start: Partial<LoadProgress> = {}) {
      value = { ...INITIAL_PROGRESS, ...start };
      emit();
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
