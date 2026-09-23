/**
 * Пульс во сне: минимальный и средний за ночь против строго своей нормы.
 *
 * Норма — по последним семи дням из кэша (тот же принцип, что у личного ориентира «Организма»:
 * окно семь дней, нужно не меньше пяти ночей с данными). Возрастные границы больше не
 * используются: у каждого свой ночной коридор, и сравнивать честнее с ним.
 *
 * По двум отклонениям — минимума и среднего — ночь попадает в одну из категорий, а у каждой
 * категории свой коэффициент к оценке сна. Диагнозов приложение не ставит.
 */

/** Окно своей нормы: последние семь дней. */
export const SLEEP_HR_BASELINE_DAYS = 7;
/** Меньше стольких ночей с данными — нормы нет и сравнивать не с чем. */
export const SLEEP_HR_BASELINE_MIN_NIGHTS = 5;
/** Меньше стольких замеров за ночь — ночь в расчёт не берём. */
export const SLEEP_HR_MIN_SAMPLES = 3;

/** Отклонение в пределах этого — «как обычно», уд/мин. */
export const NORMAL_RANGE = 3;
/** С этого отклонения говорим о заметном сдвиге, уд/мин. */
export const SIGNIFICANT_THRESHOLD = 4;

/** Оценка сна не может выйти за 100 очков, какой бы ни был коэффициент. */
export const SLEEP_SCORE_MAX = 100;

/** Пульс за одну ночь: минимальный и средний, уд/мин. */
export interface NightHr {
  min: number;
  avg: number;
}

export type SleepHrCategory = 'normal' | 'load' | 'deep' | 'uneven' | 'spike' | 'mixed';

/**
 * Цвет точки рядом с текстом: good — ночь прошла как обычно или лучше, alert — есть отклонение,
 * о котором стоит знать. Отдельного заголовка у карточки нет: вывод читается по точке и тексту.
 */
export type SleepHrTone = 'good' | 'alert' | 'unknown';

/** Названия, тексты, цвет точки и коэффициенты к оценке сна — справочная таблица категорий. */
export const SLEEP_HR_CATEGORY: Record<
  SleepHrCategory,
  { title: string; text: string; factor: number; tone: Exclude<SleepHrTone, 'unknown'> }
> = {
  normal: {
    title: 'Всё в норме',
    text:
      'Показатели сердца в пределах вашего личного коридора. Организм восстанавливался в стабильном темпе. ' +
      'Накануне нервная система не подвергалась избыточному стрессу, а режим сна и питания был оптимальным.',
    factor: 1,
    tone: 'good',
  },
  load: {
    title: 'Повышенная нагрузка',
    text:
      'Пульс ночью был стабильно выше нормы. Сердце работало в усиленном режиме и не получило отдыха. ' +
      'Обычно такой скачок вызывают алкоголь, поздний ужин, тренировка менее чем за 3 часа до сна или начинающаяся простуда.',
    factor: 0.75,
    tone: 'alert',
  },
  deep: {
    title: 'Режим глубокого расслабления',
    text:
      'Сердце достигло глубокого уровня покоя. Пульс опустился ощутимо ниже привычных значений. ' +
      'Это происходит при идеальных условиях сна (прохлада, тишина) либо указывает на глубокое физическое истощение после затяжного стресса.',
    factor: 1.25,
    tone: 'good',
  },
  uneven: {
    title: 'Неравномерный ночной ритм',
    text:
      'Зафиксирован рваный ритм. Общая нагрузка на сердце за ночь оставалась высокой, а пульс резко упал только под утро. ' +
      'Организм первую половину ночи боролся со стрессом (переваривал позднюю пищу или алкоголь) и не успел отдохнуть целиком.',
    factor: 0.5,
    tone: 'alert',
  },
  spike: {
    title: 'Резкое ускорение под утро',
    text:
      'В целом ночь прошла спокойно, но ваш минимальный пульс оказался завышен. Это означает, что под утро произошел резкий всплеск активности сердца. ' +
      'Такой эффект дают яркие или тревожные сновидения, либо резкий подъем по будильнику.',
    factor: 1,
    tone: 'alert',
  },
  // Запасной случай: минимум близок к норме, а среднее ушло далеко (или наоборот на границе).
  // Ни одна из пяти картин не подходит, поэтому вывода не делаем и оценку сна не трогаем.
  mixed: {
    title: 'Смешанная картина',
    text:
      'Минимальный и средний пульс разошлись с вашей нормой по-разному, и однозначной картины за эту ночь не складывается. ' +
      'Посмотрим на следующие ночи.',
    factor: 1,
    tone: 'alert',
  },
};

/** Текст, пока своей нормы ещё нет. */
export const SLEEP_HR_NO_BASELINE_TEXT = 'Наберётся несколько ночей — сравним с вашей нормой';

/**
 * Своя норма: среднее минимумов и среднее средних по ночам последних семи дней.
 * Ночей меньше минимума — нормы нет.
 */
export function sleepHrBaseline(nights: readonly NightHr[]): NightHr | null {
  const recent = nights.slice(-SLEEP_HR_BASELINE_DAYS);
  if (recent.length < SLEEP_HR_BASELINE_MIN_NIGHTS) return null;
  const mean = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { min: mean(recent.map((n) => n.min)), avg: mean(recent.map((n) => n.avg)) };
}

/** Пульс за ночь по замерам: минимум и среднее. Замеров мало — ночи нет. */
export function nightHrOf(values: readonly number[]): NightHr | null {
  if (values.length < SLEEP_HR_MIN_SAMPLES) return null;
  return {
    min: Math.round(Math.min(...values)),
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

const within = (delta: number) => Math.abs(delta) <= NORMAL_RANGE;
const above = (delta: number) => delta >= SIGNIFICANT_THRESHOLD;
const below = (delta: number) => delta <= -SIGNIFICANT_THRESHOLD;

/** Категория ночи по отклонениям минимума и среднего от своей нормы. Порядок проверок важен. */
export function sleepHrCategory(deltaMin: number, deltaAvg: number): SleepHrCategory {
  if (within(deltaMin) && within(deltaAvg)) return 'normal';
  if (above(deltaMin) && above(deltaAvg)) return 'load';
  if (below(deltaMin) && (below(deltaAvg) || within(deltaAvg))) return 'deep';
  if (below(deltaMin) && above(deltaAvg)) return 'uneven';
  if (above(deltaMin) && (below(deltaAvg) || within(deltaAvg))) return 'spike';
  return 'mixed';
}

/** Коэффициент к оценке сна: нормы нет — единица, оценку не трогаем. */
export const sleepHrFactor = (category: SleepHrCategory | null): number =>
  category === null ? 1 : SLEEP_HR_CATEGORY[category].factor;

/** Оценка сна с коэффициентом: сверху всегда не больше 100 очков. */
export const applySleepHrFactor = (base: number, factor: number): number =>
  Math.min(SLEEP_SCORE_MAX, Math.max(0, base * factor));

/** «-2 от вашей нормы», «+5 от вашей нормы», «как обычно». */
export const sleepHrDeltaText = (delta: number): string =>
  delta === 0 ? 'как обычно' : `${delta > 0 ? '+' : '-'}${Math.abs(delta)} от вашей нормы`;

export interface SleepHrView {
  night: NightHr;
  /** Своя норма по последним семи дням; null — ночей пока мало. */
  baseline: NightHr | null;
  /** Отклонения от нормы, уд/мин; null — нормы нет. */
  deltaMin: number | null;
  deltaAvg: number | null;
  category: SleepHrCategory | null;
  /** Название категории; null — нормы ещё нет. На экране не показывается, нужно для отладки. */
  title: string | null;
  /** Зелёная или красная точка рядом с текстом; unknown — нормы ещё нет. */
  tone: SleepHrTone;
  text: string;
  /** Коэффициент к оценке сна. */
  factor: number;
}

/** Что показать на карточке «Пульс во сне» и какой коэффициент применить к оценке сна. */
export function sleepHrCheck(night: NightHr | null, baseline: NightHr | null): SleepHrView | null {
  if (night === null) return null;
  if (baseline === null) {
    return {
      night,
      baseline: null,
      deltaMin: null,
      deltaAvg: null,
      category: null,
      title: null,
      tone: 'unknown',
      text: SLEEP_HR_NO_BASELINE_TEXT,
      factor: 1,
    };
  }
  const deltaMin = night.min - baseline.min;
  const deltaAvg = night.avg - baseline.avg;
  const category = sleepHrCategory(deltaMin, deltaAvg);
  const { title, text, factor, tone } = SLEEP_HR_CATEGORY[category];
  return { night, baseline, deltaMin, deltaAvg, category, title, tone, text, factor };
}
