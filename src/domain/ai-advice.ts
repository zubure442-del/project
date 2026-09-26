import type { ReportMode } from './report';

/**
 * «Мнение Лиса» от YandexGPT (владелец 26.09, новая архитектура): физиологию считает приложение
 * (`physiology.ts`: личные нормы, четыре временных слоя, одна доминантная связка), а модель только
 * пересказывает готовый вывод голосом Лиса. Посреднику (облачная функция `server/advice`) уходят
 * две фразы без цифр — что с телом сейчас и первопричина — и прошлые мнения Лиса (чтобы ответ
 * не повторял их; модели они не передаются). Ни имени, ни профиля, ни чисел. Текст ответа
 * проверяется и здесь: не прошёл — остаётся шаблонный совет.
 */

/** Пометка совета от модели в истории: такой совет на тот же цикл и время суток больше не запрашиваем. */
export const AI_TEMPLATE_ID = 'ai:yandexgpt';

export const isAiTemplate = (templateId: string) => templateId.startsWith('ai:');

/** Что уходит посреднику. Времена — «ЧЧ:ММ» по местному времени. */
export interface AdvicePayload {
  mode: ReportMode;
  /** Местное время запроса. */
  time: string;
  /** Вывод движка физиологии: ключ связки и две фразы без цифр. */
  insight: { key: string; consequence: string; root_cause: string };
  /** Мнения от модели за последние 7 дней: посредник отклоняет ответ, слишком похожий на них. */
  past_opinions: { ago: number; slot: ReportMode; text: string }[];
}

/**
 * Длина совета: короче — это не совет, длиннее — не помещается в карточку (посредник просит модель
 * не больше 130 символов, здесь — с небольшим запасом; размер шрифта — `adviceFontSize`).
 */
export const AI_ADVICE_MIN_CHARS = 20;
export const AI_ADVICE_MAX_CHARS = 140;

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

/** Совет можно показать: нужной длины, без цифр, запретных слов и разметки. */
export function isSafeAdvice(text: string): boolean {
  if (text.length < AI_ADVICE_MIN_CHARS || text.length > AI_ADVICE_MAX_CHARS) return false;
  if (/[*#_`<>[\]{}|]/.test(text) || /\d/.test(text)) return false;
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zа-яё]+/i).filter(Boolean);
  return !AI_ADVICE_FORBIDDEN.some((stem) => words.some((w) => w.startsWith(stem)));
}
