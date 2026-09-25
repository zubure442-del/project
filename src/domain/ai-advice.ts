import type { ReportMode } from './report';
import type { ComponentId } from './score';

/**
 * «Мнение Лиса» от YandexGPT. Приложение отправляет своему посреднику (облачная функция
 * `server/advice`) только обезличенные числа дня — без имени, возраста, веса и роста — и получает
 * две-три фразы. Текст проверяется здесь: не прошёл — остаётся шаблонный совет.
 */

/** Пометка совета от модели в истории: такой совет на тот же цикл и время суток больше не запрашиваем. */
export const AI_TEMPLATE_ID = 'ai:yandexgpt';

export const isAiTemplate = (templateId: string) => templateId.startsWith('ai:');

/** Что уходит посреднику. Только числа дня и цель — ничего, по чему можно узнать человека. */
export interface AdvicePayload {
  mode: ReportMode;
  goal: 'lose' | 'keep' | 'gain' | null;
  total: number | null;
  sleep: { score: number | null; minutes: number | null; deepMinutes: number | null };
  activity: { score: number | null; steps: number | null; norm: number | null };
  organism: { score: number | null };
  /** Самая слабая составляющая (как у шаблона); null — всё хорошо. */
  weakest: ComponentId | null;
  /** Последние выданные советы: чтобы модель не повторялась. */
  recent: string[];
}

/** Длина совета: короче — это не совет, длиннее — не помещается в карточку. */
export const AI_ADVICE_MIN_CHARS = 20;
export const AI_ADVICE_MAX_CHARS = 320;

/**
 * Чего в совете быть не должно (правила продукта): диагнозы, болезни, лечение и врачи,
 * выводы по глюкозе и давлению, обещания результата, чужие приложения и бренды, разметка.
 * Сравнение — по началу слова без учёта регистра.
 */
export const AI_ADVICE_FORBIDDEN = [
  'диагноз', 'болезн', 'заболева', 'диабет', 'гипертон', 'гипотон', 'гипогликем', 'гипергликем', 'инсульт', 'инфаркт',
  'лечени', 'лечит', 'вылеч', 'лекарств', 'таблетк', 'препарат', 'врач', 'доктор', 'медицин',
  'глюкоз', 'давлени', 'пройдёт', 'пройдет', 'гарантир',
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
