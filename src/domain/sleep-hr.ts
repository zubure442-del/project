/**
 * Пульс во сне: своя норма плюс возрастные границы.
 *
 * Границы взяты от общепринятого диапазона пульса покоя (60–100 уд/мин у взрослых)
 * с поправкой на ночное снижение: во сне пульс обычно на 10–15 % ниже дневного покоя,
 * а у подростков он выше, чем у взрослых. Это ориентиры приложения, а не диагноз:
 * в текстах мы только предлагаем показать результат врачу, если так повторяется.
 */

/** Возрастные границы пульса во сне, уд/мин: `from` — с какого возраста действует. */
export const SLEEP_HR_BANDS = [
  { from: 0, min: 50, max: 95 },
  { from: 14, min: 48, max: 90 },
  { from: 18, min: 45, max: 85 },
] as const;

/** По скольким прошлым ночам считаем свою норму и сколько их нужно минимум. */
export const SLEEP_HR_BASELINE_DAYS = 14;
export const SLEEP_HR_BASELINE_MIN_NIGHTS = 5;
/** Насколько нужно отойти от своей нормы, чтобы сказать об этом, уд/мин. */
export const SLEEP_HR_PERSONAL_DEVIATION = 10;

export const sleepHrBand = (age: number): { min: number; max: number } => {
  const band = [...SLEEP_HR_BANDS].reverse().find((b) => age >= b.from) ?? SLEEP_HR_BANDS[0];
  return { min: band.min, max: band.max };
};

/** Своя норма — среднее по прошлым ночам; ночей мало — нормы нет. */
export function sleepHrBaseline(nights: readonly number[]): number | null {
  const recent = nights.slice(-SLEEP_HR_BASELINE_DAYS);
  if (recent.length < SLEEP_HR_BASELINE_MIN_NIGHTS) return null;
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

export type SleepHrVerdict = 'plain' | 'normal' | 'low' | 'high' | 'personal-low' | 'personal-high';

export interface SleepHrView {
  value: number;
  /** Возрастные границы; null — возраст не заполнен. */
  band: { min: number; max: number } | null;
  /** Своя норма по прошлым ночам; null — ночей пока мало. */
  baseline: number | null;
  verdict: SleepHrVerdict;
  text: string;
  /** Стоит показать врачу: заметное отклонение. */
  seeDoctor: boolean;
}

const DOCTOR_REPEAT = 'Если так повторяется, стоит показать результат врачу.';

/**
 * Что написать под пульсом во сне. Сначала возрастные границы (сильное отклонение),
 * потом своя норма (заметная разница с обычными ночами), иначе — спокойный текст.
 */
export function sleepHrCheck(value: number | null, age: number | null, baseline: number | null): SleepHrView | null {
  if (value === null) return null;
  const band = age === null ? null : sleepHrBand(age);
  const base = { value, band, baseline };

  if (band && value < band.min) {
    return {
      ...base,
      verdict: 'low',
      text: `Ниже обычного для вашего возраста (${band.min}–${band.max}). ${DOCTOR_REPEAT}`,
      seeDoctor: true,
    };
  }
  if (band && value > band.max) {
    return {
      ...base,
      verdict: 'high',
      text: `Выше обычного для вашего возраста (${band.min}–${band.max}). ${DOCTOR_REPEAT}`,
      seeDoctor: true,
    };
  }
  if (baseline !== null && value - baseline >= SLEEP_HR_PERSONAL_DEVIATION) {
    return {
      ...base,
      verdict: 'personal-high',
      text: `Заметно выше вашего обычного (${baseline}). Если так несколько ночей подряд, стоит показать результат врачу.`,
      seeDoctor: true,
    };
  }
  if (baseline !== null && baseline - value >= SLEEP_HR_PERSONAL_DEVIATION) {
    return {
      ...base,
      verdict: 'personal-low',
      text: `Заметно ниже вашего обычного (${baseline}). Если так несколько ночей подряд, стоит показать результат врачу.`,
      seeDoctor: true,
    };
  }
  if (band) {
    return {
      ...base,
      verdict: 'normal',
      text: baseline === null
        ? `В пределах обычного для вашего возраста (${band.min}–${band.max}).`
        : `В пределах обычного для вашего возраста (${band.min}–${band.max}). Ваша норма — около ${baseline}.`,
      seeDoctor: false,
    };
  }
  // Возраст не заполнен: сравнивать не с чем, кроме своих ночей.
  return {
    ...base,
    verdict: 'plain',
    text: baseline === null ? 'Заполните год рождения, чтобы сравнивать с нормой.' : `Ваша обычная ночь — около ${baseline}.`,
    seeDoctor: false,
  };
}
