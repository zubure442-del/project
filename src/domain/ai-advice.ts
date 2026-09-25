import type { AdviceDay } from './advice-days';
import type { ReportMode } from './report';

/**
 * «Мнение Лиса» от YandexGPT. Приложение отправляет своему посреднику (облачная функция
 * `server/advice`) всё, кроме имени (решение владельца 26.09): профиль, оценки, таблицу чисел
 * за последние дни (`advice-days.ts`: сон, пульс во сне, вариабельность, стресс, шаги, нагрузка,
 * время еды по подъёмам глюкозы — без значений глюкозы и давления) и план Vuelo на сегодня.
 * Посредник по этим числам выбирает одно наблюдение дня (как ежедневные сообщения Oura), модель
 * говорит его голосом Лиса. Получает две фразы. Текст проверяется здесь: не прошёл — остаётся
 * шаблонный совет.
 */

/** Пометка совета от модели в истории: такой совет на тот же цикл и время суток больше не запрашиваем. */
export const AI_TEMPLATE_ID = 'ai:yandexgpt';

export const isAiTemplate = (templateId: string) => templateId.startsWith('ai:');

/** Что уходит посреднику. Всё о днях, кроме имени: числа, без выводов. Времена — «ЧЧ:ММ» по местному времени. */
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
  /** Оценки приложения за текущий цикл, 0–100: человек их видит на экране. */
  scores: { total: number | null; sleep: number | null; activity: number | null; organism: number | null };
  /**
   * Таблица чисел: строка на каждый из последних дней, где есть данные, и сегодня
   * (`adviceDaysFor`). Решение владельца 26.09: мнение Лиса — из чисел, а не из готовых фраз.
   */
  days: AdviceDay[];
  /** Шаги сегодня по часам с часа `from`; сегодняшних данных нет — null. */
  hours: { from: number; steps: number[] } | null;
  /** План Vuelo на сегодня из карточек карусели: человек его видит, на него можно сослаться. */
  plan: {
    workout: { title: string; effort: string; minutes: number; from: string; to: string } | null;
    coffee: { from: string; until: string; cups: number | null } | null;
    /** Сегодня окна для кофе нет. */
    noCoffee: boolean;
    meals: { title: string; time: string }[];
    bedtime: { from: string; to: string; wake: string; needMinutes: number; debtMinutes: number } | null;
  };
  /** Последние выданные советы: чтобы модель не повторялась ни словами, ни темой. */
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
