/**
 * Ход загрузки для экрана. Процент считается по ОЖИДАЕМЫМ длительностям частей загрузки
 * (подключение, запросы по дням, разовые запросы, запись), а не по числу запросов:
 * так он растёт равномерно по времени. Слайды меняются по четвертям процента.
 */
export type LoadStage = 1 | 2 | 3 | 4;

/** Из чего состоит загрузка: подключение с рукопожатием, четыре запроса на день, разовые 0x03/0x0B, запись. */
export type SegmentKind = 'connect' | 'steps' | 'heart' | 'summary' | 'spo2' | 'extras' | 'finalize';
export const DAY_SEGMENTS: SegmentKind[] = ['steps', 'heart', 'summary', 'spo2'];

/** Ожидаемые длительности, пока своей истории нет: 9 с на день из четырёх запросов. */
export const DEFAULT_DAY_MS = 9000;
export const DEFAULT_SEGMENT_MS: Record<SegmentKind, number> = {
  connect: 4000,
  steps: DEFAULT_DAY_MS / 4,
  heart: DEFAULT_DAY_MS / 4,
  summary: DEFAULT_DAY_MS / 4,
  spo2: DEFAULT_DAY_MS / 4,
  extras: 500,
  finalize: 300,
};
/** По скольким последним удачным загрузкам берём медиану. */
export const DURATION_HISTORY = 3;
/** Идущая часть загрузки не засчитывается больше, чем на эту долю, пока не кончится. */
export const SEGMENT_CAP = 0.95;

/** Сколько карточек с рисунками. */
export const SLIDE_COUNT = 4;
/** Карточки показываем при первом запуске или если предстоит загрузить столько дней или больше. */
export const SLIDES_MIN_DAYS = 3;
/** Каждая карточка на экране не меньше этого, даже если процент перескочил. */
export const SLIDE_MIN_MS = 3000;
/** После этого процента на последней карточке подпись «Почти готово». */
export const ALMOST_DONE = 0.95;
/** Быстрый экран без карточек: после конца загрузки ещё столько, и всего не меньше QUICK_MIN_MS. */
export const QUICK_HOLD_MS = 400;
export const QUICK_MIN_MS = 1200;
/** Смена карточки и рисунка — затухание. */
export const STAGE_FADE_MS = 200;

export type DurationHistory = Partial<Record<SegmentKind, number[]>>;

/** Ход загрузки. Живёт вне React-состояния, чтобы вкладки не перерисовывались по пакетам. */
export interface LoadProgress {
  /** Реальный этап: 1 — подключение, 2 — запросы, 3 — расчёты, 4 — запись. От него статус. */
  stage: LoadStage;
  packets: number;
  finished: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** Длинная загрузка: показываем карточки с рисунками. Иначе — быстрый экран. */
  slides: boolean;
  /** Ожидаемая длительность каждой части загрузки по порядку, мс. */
  plan: number[];
  /** Какая часть идёт сейчас и с какого момента. */
  segment: number;
  segmentStartedAt: number;
}

export const INITIAL_PROGRESS: LoadProgress = {
  stage: 1,
  packets: 0,
  finished: false,
  startedAt: 0,
  finishedAt: null,
  slides: false,
  plan: [DEFAULT_SEGMENT_MS.connect],
  segment: 0,
  segmentStartedAt: 0,
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Ожидаемая длительность части: медиана последних удачных загрузок, иначе по умолчанию. */
export function expectedMs(kind: SegmentKind, history: DurationHistory): number {
  const recent = (history[kind] ?? []).slice(-DURATION_HISTORY);
  return recent.length ? median(recent) : DEFAULT_SEGMENT_MS[kind];
}

/** Части загрузки по порядку — ровно в том порядке, в каком их проходит выгрузка. */
export function loadSegments(dayCount: number): SegmentKind[] {
  return ['connect', ...Array.from({ length: dayCount }, () => DAY_SEGMENTS).flat(), 'extras', 'finalize'];
}

export const loadPlan = (dayCount: number, history: DurationHistory) =>
  loadSegments(dayCount).map((kind) => expectedMs(kind, history));

/** Процент по ожидаемым длительностям: прошедшие части целиком, идущая — по времени, но не больше 95 %. */
export function plannedPercent(p: LoadProgress, now: number): number {
  if (p.finished) return 1;
  const total = p.plan.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const done = p.plan.slice(0, p.segment).reduce((a, b) => a + b, 0);
  const current = p.plan[p.segment] ?? 0;
  const running = Math.min(Math.max(0, now - p.segmentStartedAt), current * SEGMENT_CAP);
  return Math.min(1, (done + running) / total);
}

/** Длительности частей этой загрузки — в историю: по каждой части среднее за загрузку, последние три загрузки. */
export function recordDurations(history: DurationHistory, measured: Partial<Record<SegmentKind, number[]>>): DurationHistory {
  const next: DurationHistory = { ...history };
  for (const [kind, values] of Object.entries(measured) as [SegmentKind, number[]][]) {
    if (!values.length) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    next[kind] = [...(history[kind] ?? []), Math.round(mean)].slice(-DURATION_HISTORY);
  }
  return next;
}

/** Карточки — при первом запуске или если предстоит загрузить от SLIDES_MIN_DAYS дней. */
export const wantsSlides = (firstRun: boolean, dayCount: number) => firstRun || dayCount >= SLIDES_MIN_DAYS;

/**
 * Фоновая догрузка: кэш уже есть, а грузить немного (сегодня, иногда вчера). Экран загрузки
 * тогда не открываем — приложение сразу показывает сохранённые данные, кольцо догружает
 * сегодняшний день, и результат применяется один раз в конце. Часть дня у кольца запросить
 * нельзя (команда знает только «день назад», свежие минуты приходят последними), поэтому
 * ускорить можно только ожидание, а не саму выгрузку.
 */
export const runsInBackground = (firstRun: boolean, dayCount: number, hasCache: boolean) =>
  hasCache && !wantsSlides(firstRun, dayCount);

/** Какая карточка «положена» по проценту: 1 — 0–25 %, 2 — 25–50 %, 3 — 50–75 %, 4 — 75–100 %. */
export const slideForPercent = (percent: number) => Math.min(SLIDE_COUNT, Math.floor(percent * SLIDE_COUNT) + 1);

export interface ShownSlide {
  slide: number;
  /** Когда карточка появилась. */
  since: number;
}

/** Следующая карточка: по одной за раз и не раньше, чем через SLIDE_MIN_MS. */
export function nextSlide(shown: ShownSlide, percent: number, now: number): ShownSlide {
  if (slideForPercent(percent) <= shown.slide || now - shown.since < SLIDE_MIN_MS) return shown;
  return { slide: shown.slide + 1, since: now };
}

/** Подпись под кольцом: номер показанной карточки или «Почти готово» в самом конце долгой загрузки. */
export function slideCaption(shown: ShownSlide, percent: number, finished: boolean): string {
  return shown.slide === SLIDE_COUNT && percent >= ALMOST_DONE && !finished
    ? 'Почти готово'
    : `Шаг ${shown.slide} из ${SLIDE_COUNT}`;
}

/** Можно уходить на главный экран. */
export function canLeave(p: LoadProgress, shown: ShownSlide, now: number): boolean {
  if (!p.finished || p.finishedAt === null) return false;
  if (!p.slides) return now >= Math.max(p.finishedAt + QUICK_HOLD_MS, p.startedAt + QUICK_MIN_MS);
  return shown.slide === SLIDE_COUNT && now - shown.since >= SLIDE_MIN_MS;
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
    /** Следующая часть загрузки началась. */
    advance(now = Date.now()) {
      value = { ...value, segment: Math.min(value.plan.length - 1, value.segment + 1), segmentStartedAt: now };
      emit();
    },
    /** Начало новой загрузки: время старта, вид экрана и план частей. */
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
