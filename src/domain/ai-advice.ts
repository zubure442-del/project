import type { ReportMode } from './report';
import type { ComponentId } from './score';

/**
 * «Мнение Лиса» от YandexGPT. Приложение отправляет своему посреднику (облачная функция
 * `server/advice`) всё, что знает о дне, кроме имени (решение владельца 26.09): профиль, сон,
 * пульс во сне, активность, замеры «Организма» (без глюкозы и давления), план дня из карточек
 * карусели и наблюдения дня (`insights.ts`) — из них Лис делает догадку о привычках. Получает две-три фразы. Текст проверяется здесь: не прошёл —
 * остаётся шаблонный совет.
 */

/** Пометка совета от модели в истории: такой совет на тот же цикл и время суток больше не запрашиваем. */
export const AI_TEMPLATE_ID = 'ai:yandexgpt';

export const isAiTemplate = (templateId: string) => templateId.startsWith('ai:');

/** Что уходит посреднику. Всё о дне, кроме имени. Времена — «ЧЧ:ММ» по местному времени. */
export interface AdvicePayload {
  mode: ReportMode;
  /** Местное время запроса. */
  time: string;
  profile: {
    sex: 'male' | 'female' | null;
    age: number | null;
    heightCm: number | null;
    weightKg: number | null;
    goal: 'lose' | 'keep' | 'gain' | null;
  };
  total: number | null;
  /** Самая слабая составляющая (как у шаблона); null — всё хорошо. */
  weakest: ComponentId | null;
  sleep: {
    score: number | null;
    minutes: number | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    asleep: string | null;
    awake: string | null;
    /** Пульс во сне и отклонение от своей нормы; нормы ещё нет — отклонений нет. */
    pulse: { min: number; avg: number; vsNormMin: number | null; vsNormAvg: number | null } | null;
  };
  activity: { score: number | null; steps: number | null; norm: number | null; caloriesToday: number | null };
  organism: {
    score: number | null;
    hrv: number | null;
    restingPulse: number | null;
    spo2: number | null;
    stress: number | null;
  };
  /** План дня из карточек карусели: модель объясняет его, а не спорит с ним. */
  plan: {
    workout: { title: string; effort: string; minutes: number; from: string; to: string } | null;
    coffee: { from: string; until: string; cups: number | null } | null;
    /** Сегодня окна для кофе нет. */
    noCoffee: boolean;
    meals: { title: string; time: string }[];
    bedtime: { from: string; to: string; wake: string; needMinutes: number; debtMinutes: number } | null;
  };
  /**
   * Наблюдения дня против своей нормы (`dayInsights`): из них Лис делает догадку о том,
   * что на самом деле происходило, — частые перекусы, поздний ужин, долгое сидение.
   */
  insights: string[];
  /** Последние выданные советы: чтобы модель не повторялась. */
  recent: string[];
}

/**
 * Длина совета: короче — это не совет, длиннее — не помещается в карточку даже мелким шрифтом
 * (модель просим не больше 180 символов, здесь — с запасом; размер шрифта — `adviceFontSize`).
 */
export const AI_ADVICE_MIN_CHARS = 20;
export const AI_ADVICE_MAX_CHARS = 220;

/**
 * Чего в совете быть не должно (правила продукта): диагнозы, болезни, лечение и врачи,
 * выводы по глюкозе и давлению, оценки фигуры, обещания результата, чужие приложения и бренды,
 * разметка. Сравнение — по началу слова без учёта регистра.
 */
export const AI_ADVICE_FORBIDDEN = [
  'диагноз', 'болезн', 'заболева', 'диабет', 'гипертон', 'гипотон', 'гипогликем', 'гипергликем', 'инсульт', 'инфаркт',
  'лечени', 'лечит', 'вылеч', 'лекарств', 'таблетк', 'препарат', 'врач', 'доктор', 'медицин',
  'глюкоз', 'крови', 'кровь', 'давлени', 'пройдёт', 'пройдет', 'гарантир', 'ожирен', 'имт', 'полнот',
  'whoop', 'oura', 'garmin', 'fitbit', 'apple', 'samsung', 'xiaomi', 'huawei', 'yandex', 'яндекс', 'алиса', 'gpt',
] as const;

/** Убираем то, что модели иногда добавляют: кавычки вокруг всего текста, лишние пробелы и переводы строк. */
export function cleanAdvice(text: string): string {
  return text
    .trim()
    .replace(/^["«„“]+|["»“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Совет можно показать: нужной длины, без запретных слов и разметки. */
export function isSafeAdvice(text: string): boolean {
  if (text.length < AI_ADVICE_MIN_CHARS || text.length > AI_ADVICE_MAX_CHARS) return false;
  if (/[*#_`<>[\]{}|]/.test(text)) return false;
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zа-яё]+/i).filter(Boolean);
  return !AI_ADVICE_FORBIDDEN.some((stem) => words.some((w) => w.startsWith(stem)));
}
