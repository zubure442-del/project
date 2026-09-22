/**
 * Пульс во сне: сначала своя норма, потом возраст.
 *
 * Главное — как сегодняшняя ночь выглядит на фоне ваших обычных ночей (среднее за всё,
 * что есть в кэше). Возрастные границы — вторая проверка, на случай стабильно высокого
 * или низкого пульса. Тексты короткие: «Пульс в норме» либо предложение проконсультироваться.
 * Диагнозов приложение не ставит.
 */

/** Возрастные границы пульса во сне, уд/мин: `from` — с какого возраста действует.
 * Взяты от общепринятого пульса покоя 60–100 с поправкой на ночное снижение (10–15 %);
 * у подростков пульс выше, чем у взрослых. */
export const SLEEP_HR_BANDS = [
  { from: 0, min: 50, max: 95 },
  { from: 14, min: 48, max: 90 },
  { from: 18, min: 45, max: 85 },
] as const;

/** Сколько ночей нужно, чтобы считать своей нормой. */
export const SLEEP_HR_BASELINE_MIN_NIGHTS = 5;
/** Насколько нужно отойти от своей нормы, чтобы сказать об этом, уд/мин. */
export const SLEEP_HR_PERSONAL_DEVIATION = 10;

export const SLEEP_HR_TEXT = {
  normal: 'Пульс в норме',
  above: 'Выше обычного — стоит проконсультироваться с врачом',
  below: 'Ниже обычного — стоит проконсультироваться с врачом',
  unknown: 'Наберётся несколько ночей — сравним с вашей нормой',
} as const;

export const sleepHrBand = (age: number): { min: number; max: number } => {
  const band = [...SLEEP_HR_BANDS].reverse().find((b) => age >= b.from) ?? SLEEP_HR_BANDS[0];
  return { min: band.min, max: band.max };
};

/** Своя норма — среднее по всем ночам в кэше; ночей мало — нормы нет. */
export function sleepHrBaseline(nights: readonly number[]): number | null {
  if (nights.length < SLEEP_HR_BASELINE_MIN_NIGHTS) return null;
  return Math.round(nights.reduce((a, b) => a + b, 0) / nights.length);
}

export type SleepHrVerdict = 'normal' | 'above' | 'below' | 'unknown';

export interface SleepHrView {
  value: number;
  /** Возрастные границы; null — год рождения не заполнен. */
  band: { min: number; max: number } | null;
  /** Своя норма по прошлым ночам; null — ночей пока мало. */
  baseline: number | null;
  verdict: SleepHrVerdict;
  text: string;
  /** Стоит проконсультироваться с врачом: заметное отклонение. */
  seeDoctor: boolean;
}

/**
 * Вывод по пульсу во сне. Сначала сравнение со своей нормой, потом — с возрастными границами.
 * Нет ни нормы, ни года рождения — сравнивать не с чем, вывода не делаем.
 */
export function sleepHrCheck(value: number | null, age: number | null, baseline: number | null): SleepHrView | null {
  if (value === null) return null;
  const band = age === null ? null : sleepHrBand(age);
  const base = { value, band, baseline };
  const verdictOf = (): SleepHrVerdict => {
    if (baseline !== null) {
      if (value - baseline >= SLEEP_HR_PERSONAL_DEVIATION) return 'above';
      if (baseline - value >= SLEEP_HR_PERSONAL_DEVIATION) return 'below';
    }
    if (band) {
      if (value > band.max) return 'above';
      if (value < band.min) return 'below';
    }
    return baseline === null && band === null ? 'unknown' : 'normal';
  };
  const verdict = verdictOf();
  return { ...base, verdict, text: SLEEP_HR_TEXT[verdict], seeDoctor: verdict === 'above' || verdict === 'below' };
}
