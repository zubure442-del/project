import type { AdviceDay, MinutePoint } from './advice-days';
import type { ReportMode } from './report';

/**
 * Движок физиологии для «Мнения Лиса» (владелец 26.09): модель не умеет считать ряды — выходили
 * тавтологии и выдумки. Физиологию считает код, а YandexGPT только пересказывает готовый вывод.
 *
 * Движок видит все показатели кольца и сравнивает их со своими нормами (средние за неделю):
 * - глубокий горизонт (48–72 ч): долг глубокого сна за две ночи, тренд вариабельности, стресс два дня;
 * - ночь (12–24 ч): длительность и время отхода ко сну, пульс во сне и когда он опустился
 *   (поздно — восстановление началось с опозданием), кислород ночью;
 * - вчерашний день: нагрузка по пульсу (TRIMP), тренировка, шаги, поздний ужин, перекусы;
 * - средний горизонт (2–4 ч): статика или много движения, недавняя еда, скачки сахара, давление;
 * - оперативный срез (последние 60–90 мин): пульс против покоя, шаги, стресс.
 * Из оперативного среза и давления получается состояние сейчас (`consequence`), из остальных слоёв —
 * кандидаты в первопричину (`root_cause`). Сочетания разных систем дают свои причины: низкая
 * вариабельность после тяжёлого вчера — тело восстанавливает мышцы; поздно опустившийся ночной пульс
 * после позднего ужина или вечерней нагрузки. Каждая пара «состояние × причина» получает вес (сила
 * состояния × сила причины), пары одной природы запрещены, о чём Лис уже говорил — отодвигается:
 * повторный запрос подсвечивает другую связь. Фразы — простым разговорным языком, без цифр
 * и диагнозов. Значения давления и сахара не называются — только «выше обычного», «скачет».
 */

export type BodyState = 'idle' | 'tense-still' | 'saving' | 'still' | 'moving' | 'exertion' | 'fade' | 'tense' | 'pressure-up' | 'steady';
export type RootCause =
  | 'deep-debt'
  | 'short-night'
  | 'night-pulse'
  | 'late-recovery'
  | 'night-oxygen'
  | 'hrv-down'
  | 'hrv-up'
  | 'repair'
  | 'stress-days'
  | 'late-bed'
  | 'late-meal'
  | 'heavy-yesterday'
  | 'recent-meal'
  | 'snacking'
  | 'sugar-swings'
  | 'long-still'
  | 'active-earlier'
  | 'good-night'
  | 'calm-days'
  | 'low-night-pulse'
  | 'regular-bed'
  | 'usual-night';

export interface PhysioInput {
  /** Отрезок цикла: после пробуждения, днём, перед сном — от него зависят слова. */
  mode: ReportMode;
  /** «Сейчас» — минута последней выгрузки от полуночи сегодняшнего дня. */
  now: number;
  /** Строки по дням (`adviceDay`), ago 0 — сегодня. */
  days: readonly AdviceDay[];
  /** Ряды вчера и сегодня на одной оси: минуты от полуночи сегодня, вчерашние — отрицательные. */
  heart: readonly MinutePoint[];
  steps: readonly MinutePoint[];
  stress: readonly MinutePoint[];
  /** Верхнее давление и сахар по оценке кольца (записи 0x55 без выбросов); у старых вызовов может не быть. */
  systolic?: readonly MinutePoint[];
  glucose?: readonly MinutePoint[];
  /** Ключи связок, о которых Лис уже говорил: за этот цикл и за неделю, свежие первыми. */
  said: { today: readonly string[]; week: readonly string[] };
}

export interface Insight {
  /** «idle-deep-debt»: запоминается в истории, чтобы Лис не повторялся. */
  key: string;
  state: BodyState;
  cause: RootCause;
  /** Что с телом сейчас — простыми словами и без цифр. */
  consequence: string;
  /** Первопричина из истории кольца — без цифр. */
  rootCause: string;
  /** Сколько допустимых связок движок нашёл сейчас: одна — ротации не из чего выбирать. */
  options: number;
  /** Для «Сырого лога»: с чем сравнивал движок («пульс сейчас 78, обычный днём 74»). Посреднику не уходит. */
  debug: string;
}

// ── Пороги ──────────────────────────────────────────────────────────────────────────────────────

/**
 * «Холостой ход» — пульс на 15 % и больше выше СВОЕГО ОБЫЧНОГО ДНЁМ В ПОКОЕ почти без шагов (владелец 26.09).
 * Не выше пульса покоя: тот берётся из сна, и днём любой пульс был «заметно выше обычного».
 */
export const IDLE_PULSE_RATIO = 1.15;
/** «Почти без шагов» за час. */
export const STILL_STEPS_PER_HOUR = 100;
/** Экономный режим: пульс ниже обычного днём в покое на 5 % и больше, стресс в зоне «Низкий» (до 30). */
export const SAVING_PULSE_RATIO = 0.95;
export const SAVING_STRESS_MAX = 30;
/** Стресс «Повышенный» — от 61 (зоны стресса продукта): без шагов это высокий тонус в статике. */
export const HIGH_STRESS_MIN = 61;
/** Нагрузка сейчас — пульс выше обычного днём на 30 % при движении (тренировка, быстрый шаг, лестницы). */
export const EXERTION_PULSE_RATIO = 1.3;
/** «Ровно» — пульс в пределах ±12 % от обычного днём в покое (или пульса нет, а стресс спокойный). */
export const STEADY_PULSE_BAND = 0.12;
/** Движение сейчас — от стольких шагов за последний час (≈ четверть часа ходьбы). */
export const MOVING_STEPS_PER_HOUR = 1500;
/** Затяжная статика — не меньше двух часов и меньше стольких шагов за них. */
export const STILL_MIN_HOURS = 2;
export const STILL_MAX_STEPS = 300;
/** Стресс «выше обычного» — на столько пунктов выше своей нормы (или утра, для вечернего спада). */
export const STRESS_OVER = 15;
/** Вечерний спад ищем не раньше этого часа. */
export const FADE_FROM_MIN = 17 * 60;
/** Много движения раньше в цикле — от стольких шагов за средний горизонт. */
export const ACTIVE_EARLIER_STEPS = 4000;
/** Давление «выше обычного» — верхнее за последние 2 ч выше своей нормы на столько мм рт. ст. */
export const PRESSURE_OVER = 8;
export const PRESSURE_WINDOW_MIN = 120;

/** Короткая ночь — на столько минут короче своей нормы. */
export const SHORT_NIGHT_MIN = 45;
/** Долг глубокого сна за две ночи — от стольких минут; сильный — от DEEP_DEBT_STRONG_MIN. */
export const DEEP_DEBT_MIN = 20;
export const DEEP_DEBT_STRONG_MIN = 40;
/** Пульс во сне выше нормы — на столько ударов (как значимое отклонение в «Пульсе во сне»). */
export const NIGHT_PULSE_OVER = 4;
/**
 * Позднее восстановление: средний пульс первой половины сна выше второй на столько ударов и выше
 * своего пульса покоя — пульс опустился только к утру. Нужно не меньше NIGHT_HEART_MIN замеров.
 */
export const LATE_RECOVERY_DROP = 5;
export const NIGHT_HEART_MIN = 4;
/** Кислород ночью ниже своей нормы на столько процентов; без нормы — ниже NIGHT_SPO2_LOW (как в «Пике»). */
export const NIGHT_SPO2_DROP = 1.5;
export const NIGHT_SPO2_LOW = 95;
/**
 * Спокойные причины для ровного дня (чтобы Лис не повторял «ночь прошла как обычно»): стресс двух
 * дней ниже нормы на столько пунктов, пульс во сне ниже нормы на столько ударов, отбой в пределах
 * стольких минут от привычного.
 */
export const CALM_DAYS_UNDER = 5;
export const NIGHT_PULSE_UNDER = 3;
export const REGULAR_BED_MIN = 20;
/** Тренд вариабельности — на 10 % от недельной нормы. */
export const HRV_TREND_SHARE = 0.1;
/** Стресс два дня подряд выше нормы — на столько пунктов. */
export const STRESS_DAYS_OVER = 10;
/** Поздно лёг — на столько минут позже привычного. */
export const LATE_BED_MIN = 60;
/** Поздний ужин — последний приём пищи не раньше чем за столько минут до сна. */
export const LATE_MEAL_BEFORE_SLEEP_MIN = 150;
/** Вечерняя нагрузка вчера — от стольких шагов с 19:00 до сна. */
export const EVENING_LOAD_STEPS = 3000;
/**
 * Недавний приём пищи: начался от RECENT_MEAL_SKIP_MIN до RECENT_MEAL_MIN назад. Сильнее всего
 * отклик через 30–60 минут после еды (владелец 26.09: скачок пульса и сонливость — это еда, а не усталость).
 */
export const RECENT_MEAL_MIN = 120;
export const RECENT_MEAL_SKIP_MIN = 20;
export const MEAL_PEAK_FROM_MIN = 30;
export const MEAL_PEAK_TO_MIN = 60;
/** Перекусов больше обычного — на столько приёмов больше своей нормы и не меньше SNACKING_MIN за день. */
export const SNACKING_OVER = 1;
export const SNACKING_MIN = 4;
/** Сахар скачет — размах за день в полтора раза больше своего и не меньше SUGAR_SWING_MIN ммоль/л. */
export const SUGAR_SWING_RATIO = 1.5;
export const SUGAR_SWING_MIN = 1.5;
/** Тяжёлый вчерашний день — нагрузка по пульсу в полтора раза или шаги в 1.4 раза выше обычного. */
export const HEAVY_LOAD_RATIO = 1.5;
export const HEAVY_STEPS_RATIO = 1.4;
/** Своей нормы нет, пока дней с данными меньше этого. */
export const BASELINE_MIN_DAYS = 3;
/**
 * О чём уже говорили на этой неделе — вес связки ×0.25; причина уже звучала в этом цикле — ×0.4.
 * Связка, сказанная в этом цикле, не повторяется вовсе, пока есть другая (`findInsight`).
 */
const SAID_WEEK_FACTOR = 0.25;
const SAID_TODAY_FACTOR = 0.4;

// ── Совместимость: какие причины объясняют какое состояние ─────────────────────────────────────

const NIGHT_CAUSES: readonly RootCause[] = ['short-night', 'deep-debt', 'late-bed', 'night-pulse', 'late-recovery', 'night-oxygen'];

/**
 * Только причины другой природы, чем само состояние: статику не объясняем статикой, движение — движением.
 * Состояния, в тексте которых уже есть «почти не двигаетесь», не объясняются статикой.
 */
export const CAUSES_FOR: Record<BodyState, readonly RootCause[]> = {
  idle: [...NIGHT_CAUSES, 'recent-meal', 'hrv-down', 'stress-days', 'heavy-yesterday', 'snacking', 'sugar-swings'],
  'tense-still': [...NIGHT_CAUSES, 'stress-days', 'hrv-down', 'sugar-swings'],
  saving: [...NIGHT_CAUSES, 'recent-meal', 'active-earlier', 'heavy-yesterday', 'repair', 'hrv-up', 'good-night', 'usual-night', 'snacking', 'sugar-swings'],
  still: [...NIGHT_CAUSES, 'heavy-yesterday', 'repair', 'hrv-down'],
  moving: ['good-night', 'hrv-up', 'calm-days', 'low-night-pulse', 'regular-bed', 'usual-night'],
  exertion: ['good-night', 'hrv-up', 'calm-days', 'low-night-pulse', 'usual-night', 'heavy-yesterday', 'short-night', 'deep-debt'],
  fade: [...NIGHT_CAUSES, 'hrv-down', 'heavy-yesterday', 'repair', 'late-meal', 'snacking', 'sugar-swings'],
  tense: [...NIGHT_CAUSES, 'stress-days', 'hrv-down', 'late-meal', 'long-still', 'sugar-swings'],
  'pressure-up': [...NIGHT_CAUSES, 'stress-days', 'long-still'],
  steady: ['good-night', 'hrv-up', 'calm-days', 'low-night-pulse', 'regular-bed', 'active-earlier', 'usual-night'],
};

// ── Фразы: [умеренно, сильно]. Простой разговорный язык, без канцелярита и цифр ─────────────────

type Pair = readonly [string, string];

export const STATE_TEXT: Record<BodyState, Record<ReportMode, Pair>> = {
  idle: {
    morning: ['С утра пульс чуть выше обычного, хотя вы почти не двигаетесь', 'С утра пульс заметно выше обычного, хотя вы почти не двигаетесь'],
    day: ['Пульс сейчас чуть выше обычного, хотя вы почти не двигаетесь', 'Пульс сейчас заметно выше обычного, хотя вы почти не двигаетесь'],
    evening: ['Вечером пульс не опускается, хотя вы почти не двигаетесь', 'Вечером пульс заметно выше обычного, хотя движения почти нет'],
  },
  'tense-still': {
    morning: ['С утра стресс высокий, а вы почти не двигаетесь', 'С утра стресс очень высокий, а движения почти нет'],
    day: ['Стресс сейчас высокий, а вы почти не двигаетесь', 'Стресс сейчас очень высокий, а движения почти нет'],
    evening: ['Вечером стресс высокий, а вы почти не двигаетесь', 'Вечером стресс очень высокий, а движения почти нет'],
  },
  saving: {
    morning: ['Утро идёт в экономном режиме: пульс низкий, стресса почти нет', 'Утро идёт в очень экономном режиме, тело бережёт силы'],
    day: ['Тело сейчас экономит силы: пульс низкий, стресса почти нет', 'Тело сейчас сильно экономит силы, пульс и стресс на минимуме'],
    evening: ['Вечером тело экономит силы: пульс низкий, стресса почти нет', 'Вечером тело сильно экономит силы, пульс и стресс на минимуме'],
  },
  still: {
    morning: ['С утра вы почти не двигались', 'С утра прошло уже несколько часов почти без движения'],
    day: ['Последние часы вы почти не двигаетесь', 'Уже несколько часов почти без движения'],
    evening: ['Вечер проходит почти без движения', 'Весь вечер почти без движения'],
  },
  moving: {
    morning: ['Утро началось с хорошего движения', 'Утро идёт бодро, вы много двигаетесь'],
    day: ['Вы сейчас в движении, и пульс легко подстраивается', 'Вы сейчас много двигаетесь, и пульс легко успевает'],
    evening: ['Вечером вы ещё в движении', 'Вечер идёт бодро, движения много'],
  },
  fade: {
    morning: ['Стресс растёт, а движения становится меньше', 'Стресс заметно растёт, а движения почти нет'],
    day: ['Ближе к вечеру стресс растёт, а движения мало', 'Ближе к вечеру стресс заметно вырос, а сил меньше'],
    evening: ['К вечеру стресс растёт, а сил становится меньше', 'К вечеру стресс заметно вырос, а сил заметно меньше'],
  },
  tense: {
    morning: ['С утра стресс выше вашего обычного', 'С утра стресс заметно выше вашего обычного'],
    day: ['Стресс сейчас выше вашего обычного', 'Стресс сейчас заметно выше вашего обычного'],
    evening: ['Вечером стресс выше вашего обычного', 'Вечером стресс заметно выше вашего обычного'],
  },
  'pressure-up': {
    morning: ['С утра давление держится выше вашего обычного', 'С утра давление заметно выше вашего обычного'],
    day: ['Давление сейчас держится выше вашего обычного', 'Давление сейчас заметно выше вашего обычного'],
    evening: ['Вечером давление держится выше вашего обычного', 'Вечером давление заметно выше вашего обычного'],
  },
  exertion: {
    morning: ['С утра пульс высокий, тело сейчас в нагрузке', 'С утра пульс очень высокий, тело в серьёзной нагрузке'],
    day: ['Пульс сейчас высокий, тело в нагрузке', 'Пульс сейчас очень высокий, тело в серьёзной нагрузке'],
    evening: ['Вечером пульс высокий, тело в нагрузке', 'Вечером пульс очень высокий, тело в серьёзной нагрузке'],
  },
  steady: {
    morning: ['Утро идёт ровно: пульс и стресс в вашей норме', 'Утро идёт ровно, тело в хорошей форме'],
    day: ['День идёт ровно: пульс и стресс в вашей норме', 'День идёт ровно, тело держит хорошую форму'],
    evening: ['Вечер проходит ровно, пульс и стресс в норме', 'Вечер проходит ровно, тело в хорошей форме'],
  },
};

export const CAUSE_TEXT: Record<RootCause, Pair> = {
  'deep-debt': ['Две последние ночи глубокого сна было меньше обычного', 'Две ночи подряд глубокого сна заметно меньше вашей нормы'],
  'short-night': ['Прошлой ночью вы спали меньше обычного', 'Прошлой ночью вы спали заметно меньше обычного'],
  'night-pulse': ['Ночью пульс был выше вашего обычного', 'Ночью пульс был заметно выше вашего обычного'],
  'late-recovery': ['Ночью пульс опустился до обычного только под утро', 'Ночью пульс долго не опускался и успокоился только под утро'],
  'night-oxygen': ['Ночью кислород в крови был ниже вашего обычного', 'Ночью кислород в крови заметно проседал'],
  'hrv-down': ['Последние два дня тело восстанавливается хуже обычного', 'Последние два дня тело восстанавливается заметно хуже обычного'],
  'hrv-up': ['Последние два дня тело восстанавливается лучше обычного', 'Последние два дня тело восстанавливается заметно лучше обычного'],
  repair: ['После вчерашней нагрузки тело сегодня восстанавливает мышцы', 'Вчерашняя нагрузка была большой, и тело сегодня чинит мышцы'],
  'stress-days': ['Стресс держится выше обычного уже второй день', 'Два дня подряд стресс заметно выше вашего обычного'],
  'late-bed': ['Прошлой ночью вы легли позже обычного', 'Прошлой ночью вы легли намного позже обычного'],
  'late-meal': ['Вчера вы поели незадолго до сна', 'Вчера вы поели совсем незадолго до сна'],
  'heavy-yesterday': ['Вчера нагрузка была больше обычной', 'Вчера нагрузка была заметно больше обычной'],
  'recent-meal': ['Недавно была еда, и тело занято перевариванием', 'Совсем недавно была еда, и тело занято перевариванием'],
  snacking: ['Сегодня перекусов больше, чем обычно', 'Сегодня перекусов заметно больше, чем обычно'],
  'sugar-swings': ['Сахар сегодня скачет сильнее обычного', 'Сахар сегодня скачет заметно сильнее обычного'],
  'long-still': ['Последние часы прошли почти без движения', 'Уже несколько часов подряд почти без движения'],
  'active-earlier': ['Раньше сегодня было много движения', 'Сегодня уже было очень много движения'],
  'good-night': ['Ночь была полноценной, с хорошим глубоким сном', 'Ночь была длинной и глубокой, лучше обычной'],
  'calm-days': ['Последние два дня стресс ниже вашего обычного', 'Последние два дня стресс заметно ниже вашего обычного'],
  'low-night-pulse': ['Ночью пульс опускался ниже вашего обычного', 'Ночью пульс опускался заметно ниже обычного, тело хорошо отдохнуло'],
  'regular-bed': ['Вы легли спать в своё привычное время', 'Вы легли спать точно в своё привычное время'],
  'usual-night': ['Ночь прошла как обычно', 'Ночь прошла как обычно, без отклонений'],
};

/** Уточнённые фразы, когда данные позволяют сказать точнее. */
export const CAUSE_DETAIL = {
  workout: {
    cardio: 'Вчера была кардиотренировка, тело ещё восстанавливается',
    strength: 'Вчера была силовая тренировка, мышцы ещё восстанавливаются',
  },
  repairAfterWorkout: 'Вчерашняя тренировка была тяжёлой, и тело сегодня восстанавливает мышцы',
  lateRecoveryAfterMeal: 'После позднего ужина пульс ночью опустился только под утро',
  lateRecoveryAfterLoad: 'После вечерней нагрузки пульс ночью опустился только под утро',
  oxygenLongSleep: 'Сон был долгим, но кислород в крови ночью проседал',
  snackingYesterday: 'Вчера перекусов было больше, чем обычно',
} as const;

// ── Расчёт ──────────────────────────────────────────────────────────────────────────────────────

const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const nums = (values: readonly (number | null)[]) => values.filter((v): v is number => v !== null);
const clockMin = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Время отхода ко сну как минуты вечера: после полуночи — больше 1440, чтобы 00:30 было позже 23:30. */
const bedMin = (clock: string) => {
  const m = clockMin(clock);
  return m < 12 * 60 ? m + 1440 : m;
};
const cap = (v: number) => Math.min(2, v);

type Found<K> = { key: K; strength: number; text?: string };

/** Своя норма по дням `from..to` (ago), если дней с данными хватает. */
function norm(days: readonly AdviceDay[], pick: (d: AdviceDay) => number | null, from: number, to: number, min = BASELINE_MIN_DAYS) {
  const values = nums(days.filter((d) => d.ago >= from && d.ago <= to).map(pick));
  return values.length >= min ? mean(values) : null;
}

const inWindow = (points: readonly MinutePoint[], from: number, to: number) => points.filter((p) => p.m > from && p.m <= to);
const sum = (points: readonly MinutePoint[]) => points.reduce((a, p) => a + p.v, 0);
/**
 * Обычный пульс днём в покое: медиана по прошлым дням (от двух), иначе — по сегодняшним замерам.
 * Именно с ним сравнивается пульс сейчас.
 */
export const dayPulseOf = (days: readonly AdviceDay[]) =>
  norm(days, (d) => d.quietPulse, 1, 7, 2) ?? days.find((d) => d.ago === 0)?.quietPulse ?? null;
const restingOf = (days: readonly AdviceDay[]) => norm(days, (d) => d.restingPulse, 1, 7, 1) ?? days.find((d) => d.ago === 0)?.restingPulse ?? null;

/** Состояние тела сейчас по оперативному срезу, среднему горизонту и давлению. */
export function bodyStates(input: PhysioInput): Found<BodyState>[] {
  const { now, days } = input;
  const today = days.find((d) => d.ago === 0);
  const rest = dayPulseOf(days);
  const pulse = mean(inWindow(input.heart, now - 90, now).map((p) => p.v));
  const stress = mean(inWindow(input.stress, now - 90, now).map((p) => p.v));
  const stepsNow = sum(inWindow(input.steps, now - 60, now));
  const wake = today?.awake ? clockMin(today.awake) : null;
  const midFrom = Math.max(now - 240, wake ?? now - 240);
  const midHours = (now - midFrom) / 60;
  const stepsMid = sum(inWindow(input.steps, midFrom, now));
  const out: Found<BodyState>[] = [];

  const quiet = stepsNow < STILL_STEPS_PER_HOUR;
  if (quiet && rest !== null && pulse !== null && pulse >= rest * IDLE_PULSE_RATIO) {
    out.push({ key: 'idle', strength: cap((pulse / rest - 1) / (IDLE_PULSE_RATIO - 1)) });
  }
  if (quiet && stress !== null && stress >= HIGH_STRESS_MIN) {
    out.push({ key: 'tense-still', strength: cap(1 + (stress - HIGH_STRESS_MIN) / 20) });
  }
  if (quiet && rest !== null && pulse !== null && pulse <= rest * SAVING_PULSE_RATIO && (stress === null || stress <= SAVING_STRESS_MAX)) {
    out.push({ key: 'saving', strength: 1 });
  }
  if (midHours >= STILL_MIN_HOURS && stepsMid < STILL_MAX_STEPS) {
    out.push({ key: 'still', strength: cap(midHours / STILL_MIN_HOURS) });
  }
  if (stepsNow >= MOVING_STEPS_PER_HOUR) out.push({ key: 'moving', strength: cap(stepsNow / MOVING_STEPS_PER_HOUR) });
  if (!quiet && rest !== null && pulse !== null && pulse >= rest * EXERTION_PULSE_RATIO) {
    out.push({ key: 'exertion', strength: cap((pulse / rest - 1) / (EXERTION_PULSE_RATIO - 1)) });
  }
  if (now >= FADE_FROM_MIN && wake !== null && stress !== null && stepsNow < MOVING_STEPS_PER_HOUR / 3) {
    const morning = mean(inWindow(input.stress, wake, wake + 240).map((p) => p.v));
    if (morning !== null && now - wake >= 360 && stress >= morning + STRESS_OVER) {
      out.push({ key: 'fade', strength: cap((stress - morning) / STRESS_OVER) });
    }
  }
  const stressNorm = norm(days, (d) => d.stress, 1, 7);
  if (!quiet && stress !== null && stressNorm !== null && stress >= stressNorm + STRESS_OVER) {
    out.push({ key: 'tense', strength: cap((stress - stressNorm) / STRESS_OVER) });
  }
  const systolic = mean(inWindow(input.systolic ?? [], now - PRESSURE_WINDOW_MIN, now).map((p) => p.v));
  const systolicNorm = norm(days, (d) => d.systolic, 1, 7);
  if (systolic !== null && systolicNorm !== null && systolic >= systolicNorm + PRESSURE_OVER) {
    out.push({ key: 'pressure-up', strength: cap((systolic - systolicNorm) / PRESSURE_OVER) });
  }
  // «Ровно» — только когда больше ничего не видно: иначе по кнопке Лис говорил «пульс в порядке»
  // сразу после «пульс выше обычного» (владелец 26.09). Все остальные состояния верны одновременно.
  // И пульс должен быть рядом с обычным: 123 при прогулке — не «ровно».
  const pulseUsual = pulse === null || rest === null || Math.abs(pulse / rest - 1) <= STEADY_PULSE_BAND;
  if (!out.length && pulseUsual && (pulse !== null || stress !== null)) out.push({ key: 'steady', strength: 0.3 });
  return out;
}

/** Кандидаты в первопричину — из ночи, вчерашнего дня, глубокого и среднего горизонта. */
export function rootCauses(input: PhysioInput): Found<RootCause>[] {
  const { now, days } = input;
  const day = (ago: number) => days.find((d) => d.ago === ago) ?? null;
  const d0 = day(0);
  const d1 = day(1);
  const out: Found<RootCause>[] = [];
  const push = (key: RootCause, strength: number, text?: string) => out.push({ key, strength: cap(strength), ...(text ? { text } : {}) });

  // Глубокий горизонт: долг глубокого сна за две ночи против нормы за неделю до них.
  const deepNorm = norm(days, (d) => d.deepMin, 2, 7);
  const deepNights = nums([d0?.deepMin ?? null, d1?.deepMin ?? null]);
  if (deepNorm !== null && deepNights.length) {
    const debt = deepNights.reduce((a, v) => a + Math.max(0, deepNorm - v), 0);
    if (debt >= DEEP_DEBT_MIN) push('deep-debt', debt / DEEP_DEBT_STRONG_MIN);
  }
  // Стресс два дня подряд выше нормы.
  const stressRecent = norm(days, (d) => d.stress, 1, 2, 2);
  const stressNorm = norm(days, (d) => d.stress, 3, 7);
  if (stressRecent !== null && stressNorm !== null && stressRecent >= stressNorm + STRESS_DAYS_OVER) {
    push('stress-days', (stressRecent - stressNorm) / (STRESS_DAYS_OVER * 1.5));
  }
  if (stressRecent !== null && stressNorm !== null && stressRecent <= stressNorm - CALM_DAYS_UNDER) {
    push('calm-days', 0.5 + (stressNorm - stressRecent) / (CALM_DAYS_UNDER * 4));
  }

  // Ночь: длительность, время отхода, пульс во сне и когда он опустился, кислород.
  const sleepNorm = norm(days, (d) => d.sleepMin, 1, 7);
  if (d0?.sleepMin != null && sleepNorm !== null && d0.sleepMin <= sleepNorm - SHORT_NIGHT_MIN) {
    push('short-night', (sleepNorm - d0.sleepMin) / 60);
  }
  const pulseNorm = norm(days, (d) => d.nightPulse, 1, 7);
  if (d0?.nightPulse != null && pulseNorm !== null && d0.nightPulse - pulseNorm >= NIGHT_PULSE_OVER) {
    push('night-pulse', (d0.nightPulse - pulseNorm) / (NIGHT_PULSE_OVER * 1.5));
  }
  if (d0?.nightPulse != null && pulseNorm !== null && pulseNorm - d0.nightPulse >= NIGHT_PULSE_UNDER) {
    push('low-night-pulse', 0.5 + (pulseNorm - d0.nightPulse) / (NIGHT_PULSE_UNDER * 4));
  }
  const bedNorm = norm(days, (d) => (d.asleep ? bedMin(d.asleep) : null), 1, 7);
  const bed = d0?.asleep ? bedMin(d0.asleep) : null;
  if (bed !== null && bedNorm !== null && bed - bedNorm >= LATE_BED_MIN) {
    push('late-bed', (bed - bedNorm) / (LATE_BED_MIN * 1.5));
  }
  if (bed !== null && bedNorm !== null && Math.abs(bed - bedNorm) <= REGULAR_BED_MIN) push('regular-bed', 0.4);
  const lastMeal = d1?.meals.length ? Math.max(...d1.meals.map(clockMin)) : null;
  const lateMeal = lastMeal !== null && bed !== null && bed - lastMeal >= 0 && bed - lastMeal <= LATE_MEAL_BEFORE_SLEEP_MIN;
  if (lateMeal) push('late-meal', 1);
  // Когда ночью опустился пульс: первая половина сна против второй, на оси сегодняшнего дня.
  const wake = d0?.awake ? clockMin(d0.awake) : null;
  if (bed !== null && wake !== null) {
    const from = bed - 1440;
    const night = input.heart.filter((p) => p.m >= from && p.m <= wake);
    const mid = (from + wake) / 2;
    const first = mean(night.filter((p) => p.m < mid).map((p) => p.v));
    const second = mean(night.filter((p) => p.m >= mid).map((p) => p.v));
    const rest = restingOf(days);
    if (night.length >= NIGHT_HEART_MIN && first !== null && second !== null && first - second >= LATE_RECOVERY_DROP && (rest === null || first >= rest)) {
      const eveningSteps = sum(inWindow(input.steps, 19 * 60 - 1440, from));
      const text = lateMeal
        ? CAUSE_DETAIL.lateRecoveryAfterMeal
        : eveningSteps >= EVENING_LOAD_STEPS || d1?.workout
          ? CAUSE_DETAIL.lateRecoveryAfterLoad
          : undefined;
      push('late-recovery', (first - second) / (LATE_RECOVERY_DROP * 1.2) + (text ? 0.3 : 0), text);
    }
  }
  const spo2Norm = norm(days, (d) => d.nightSpo2, 1, 7);
  if (d0?.nightSpo2 != null) {
    const drop = spo2Norm !== null ? spo2Norm - d0.nightSpo2 : null;
    const low = drop !== null ? drop >= NIGHT_SPO2_DROP : d0.nightSpo2 < NIGHT_SPO2_LOW;
    if (low) {
      const longSleep = d0.sleepMin != null && sleepNorm !== null && d0.sleepMin >= sleepNorm;
      const strength = drop !== null ? drop / (NIGHT_SPO2_DROP * 1.5) : 1;
      push('night-oxygen', longSleep ? strength * 1.2 : strength, longSleep ? CAUSE_DETAIL.oxygenLongSleep : undefined);
    }
  }
  const deepGood = deepNorm === null || (d0?.deepMin != null && d0.deepMin >= deepNorm);
  if (d0?.sleepMin != null && sleepNorm !== null && d0.sleepMin >= sleepNorm && deepGood) push('good-night', 0.8);
  if (d0?.sleepMin != null) push('usual-night', 0.2);

  // Вчерашний день: нагрузка по пульсу, тренировка, шаги. Вместе с просевшей вариабельностью — восстановление мышц.
  const loadNorm = norm(days, (d) => d.load, 2, 7);
  const stepsNorm = norm(days, (d) => d.steps, 2, 7);
  let heavy = 0;
  if (d1?.workout) heavy = 1;
  if (d1?.load != null && loadNorm !== null && loadNorm > 0 && d1.load >= loadNorm * HEAVY_LOAD_RATIO) heavy = Math.max(heavy, d1.load / (loadNorm * HEAVY_LOAD_RATIO));
  if (d1?.steps != null && stepsNorm !== null && stepsNorm > 0 && d1.steps >= stepsNorm * HEAVY_STEPS_RATIO) heavy = Math.max(heavy, d1.steps / (stepsNorm * HEAVY_STEPS_RATIO));
  if (heavy > 0) push('heavy-yesterday', heavy, d1?.workout ? CAUSE_DETAIL.workout[d1.workout] : undefined);
  // Вариабельность: сегодня и тренд двух дней против недели до них.
  const hrvNorm = norm(days, (d) => d.hrv, 2, 7);
  const hrvNow = norm(days, (d) => d.hrv, 0, 1, 1);
  if (hrvNow !== null && hrvNorm !== null && hrvNorm > 0) {
    const change = hrvNow / hrvNorm - 1;
    if (change <= -HRV_TREND_SHARE) push('hrv-down', -change / (HRV_TREND_SHARE * 1.5));
    if (change >= HRV_TREND_SHARE) push('hrv-up', change / (HRV_TREND_SHARE * 1.5));
  }
  const hrvToday = d0?.hrv ?? null;
  if (heavy > 0 && hrvToday !== null && hrvNorm !== null && hrvNorm > 0 && hrvToday <= hrvNorm * (1 - HRV_TREND_SHARE)) {
    const drop = 1 - hrvToday / hrvNorm;
    push('repair', heavy * 0.6 + drop / (HRV_TREND_SHARE * 1.5), d1?.workout ? CAUSE_DETAIL.repairAfterWorkout : undefined);
    // Связка двух систем говорит больше, чем каждая по отдельности: одиночные причины отходят на второй план.
    for (const c of out) if (c.key === 'heavy-yesterday' || c.key === 'hrv-down') c.strength *= 0.5;
  }

  // Еда и сахар: недавний приём (сильнее всего через 30–60 минут), перекусы, скачки сахара.
  const ago = (d0?.meals ?? []).map((m) => now - clockMin(m)).filter((a) => a >= RECENT_MEAL_SKIP_MIN && a <= RECENT_MEAL_MIN);
  if (ago.length) push('recent-meal', ago.some((a) => a >= MEAL_PEAK_FROM_MIN && a <= MEAL_PEAK_TO_MIN) ? 1.5 : 1);
  const mealsNorm = norm(days, (d) => (d.meals.length ? d.meals.length : null), 1, 7);
  if (mealsNorm !== null) {
    if (d0 && d0.meals.length >= Math.max(SNACKING_MIN, mealsNorm + SNACKING_OVER)) {
      push('snacking', (d0.meals.length - mealsNorm) / 2);
    } else if (d1 && d1.meals.length >= Math.max(SNACKING_MIN, mealsNorm + SNACKING_OVER + 1)) {
      push('snacking', (d1.meals.length - mealsNorm) / 3, CAUSE_DETAIL.snackingYesterday);
    }
  }
  const sugar = (input.glucose ?? []).filter((p) => p.m >= 0 && p.m <= now).map((p) => p.v);
  const rangeNorm = norm(days, (d) => d.glucoseRange, 1, 7);
  if (sugar.length >= 3 && rangeNorm !== null) {
    const range = Math.max(...sugar) - Math.min(...sugar);
    if (range >= Math.max(SUGAR_SWING_MIN, rangeNorm * SUGAR_SWING_RATIO)) push('sugar-swings', range / (rangeNorm * SUGAR_SWING_RATIO * 1.2));
  }

  // Средний горизонт сегодня: статика или много движения.
  const midFrom = Math.max(now - 240, wake ?? now - 240);
  const midTo = now - 60;
  if (midTo - midFrom >= STILL_MIN_HOURS * 60 && sum(inWindow(input.steps, midFrom, midTo)) < STILL_MAX_STEPS) {
    push('long-still', (midTo - midFrom) / (STILL_MIN_HOURS * 60));
  }
  const normMet = d0?.steps != null && d0.stepNorm != null && d0.steps >= d0.stepNorm;
  if (sum(inWindow(input.steps, midFrom, now)) >= ACTIVE_EARLIER_STEPS || normMet) push('active-earlier', normMet ? 1.2 : 1);
  return out;
}

/** Цифры, с которыми сравнивал движок, — только для «Сырого лога» на телефоне. */
function debugLine(input: PhysioInput): string {
  const r = (v: number | null) => (v === null ? '—' : String(Math.round(v)));
  const pulse = mean(inWindow(input.heart, input.now - 90, input.now).map((p) => p.v));
  const stress = mean(inWindow(input.stress, input.now - 90, input.now).map((p) => p.v));
  const steps = sum(inWindow(input.steps, input.now - 60, input.now));
  return `пульс сейчас ${r(pulse)}, обычный днём в покое ${r(dayPulseOf(input.days))}, покоя во сне ${r(restingOf(input.days))}; стресс ${r(stress)}; шагов за час ${steps}`;
}

/** Все допустимые связки по весу, самая яркая первой (с учётом того, о чём Лис уже говорил). */
export function rankInsights(input: PhysioInput): { state: Found<BodyState>; cause: Found<RootCause>; score: number }[] {
  const states = bodyStates(input);
  const causes = rootCauses(input);
  const pairs: { state: Found<BodyState>; cause: Found<RootCause>; score: number }[] = [];
  for (const state of states) {
    for (const cause of causes) {
      if (!CAUSES_FOR[state.key].includes(cause.key)) continue;
      const key = `${state.key}-${cause.key}`;
      let score = state.strength * cause.strength;
      if (input.said.week.includes(key)) score *= SAID_WEEK_FACTOR;
      if (input.said.today.some((k) => k.endsWith(`-${cause.key}`))) score *= SAID_TODAY_FACTOR;
      pairs.push({ state, cause, score });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

/**
 * Доминантная связка «состояние сейчас ← первопричина». null — сказать нечего (нет замеров
 * за последний час или нет ни одной подходящей причины): тогда остаётся шаблонный совет.
 */
export function findInsight(input: PhysioInput): Insight | null {
  // Ротация: связку, сказанную в этом цикле, не повторяем, пока есть другая актуальная; все
  // сказаны — берём ту, что звучала давнее всех (`said.today` — свежие первыми).
  const ranked = rankInsights(input);
  const keyOf = (p: (typeof ranked)[number]) => `${p.state.key}-${p.cause.key}`;
  const best =
    ranked.find((p) => !input.said.today.includes(keyOf(p))) ??
    [...ranked].sort((a, b) => input.said.today.indexOf(keyOf(b)) - input.said.today.indexOf(keyOf(a)))[0];
  if (!best) return null;
  const strong = (s: number) => (s >= 1.5 ? 1 : 0);
  const { state, cause } = best;
  return {
    key: `${state.key}-${cause.key}`,
    state: state.key,
    cause: cause.key,
    consequence: `${STATE_TEXT[state.key][input.mode][strong(state.strength)]}.`,
    rootCause: `${cause.text ?? CAUSE_TEXT[cause.key][strong(cause.strength)]}.`,
    options: ranked.length,
    debug: debugLine(input),
  };
}
