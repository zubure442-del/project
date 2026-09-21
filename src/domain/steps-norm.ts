/**
 * Дневная норма шагов вместо фиксированных 10 000.
 * База растёт из собственной истории человека, а сон за сегодня её немного подправляет.
 */

/** Норма по умолчанию: у новичка без истории и доля «неизвестных» дней в базе. */
export const STEPS_DEFAULT_NORM = 10000;
/** Сколько дней до сегодняшнего смотрим (сегодня не входит). */
export const STEP_HISTORY_DAYS = 7;
/** День в истории считаем, только если шагов не меньше: иначе кольцо, скорее всего, не носили. */
export const STEP_WORN_MIN = 1000;
/** Норма чуть выше своего среднего — чтобы было куда расти. */
export const STEP_GROWTH = 1.1;
/** Коэффициент сна: f = SLEEP_FACTOR_BASE + SLEEP_FACTOR_RANGE × оценка сна / 100. */
export const SLEEP_FACTOR_BASE = 0.85;
export const SLEEP_FACTOR_RANGE = 0.3;
/** Норму округляем до сотен и держим в этих пределах. */
export const NORM_ROUND = 100;
export const NORM_MIN = 5000;
export const NORM_MAX = 15000;

/**
 * База: (n/7) × среднее × 1.10 + (1 − n/7) × 10 000, где n — дни истории с шагами от 1 000.
 * `history` — шаги за дни до сегодняшнего (не больше STEP_HISTORY_DAYS, пропуски просто отсутствуют).
 */
export function stepNormBase(history: readonly number[]): number {
  const worn = history.filter((s) => s >= STEP_WORN_MIN).slice(-STEP_HISTORY_DAYS);
  if (!worn.length) return STEPS_DEFAULT_NORM;
  const share = worn.length / STEP_HISTORY_DAYS;
  const mean = worn.reduce((a, b) => a + b, 0) / worn.length;
  return share * mean * STEP_GROWTH + (1 - share) * STEPS_DEFAULT_NORM;
}

/** Коэффициент сна: выспался — норма выше, не выспался — ниже. Нет оценки сна — 1. */
export const sleepFactor = (sleepScore: number | null): number =>
  sleepScore === null ? 1 : SLEEP_FACTOR_BASE + (SLEEP_FACTOR_RANGE * sleepScore) / 100;

/** Норма = clamp(round(база × f, до сотен), 5 000, 15 000). */
export function stepNorm(history: readonly number[], sleepScore: number | null): number {
  const raw = Math.round((stepNormBase(history) * sleepFactor(sleepScore)) / NORM_ROUND) * NORM_ROUND;
  return Math.min(NORM_MAX, Math.max(NORM_MIN, raw));
}

/** Сохранённая норма дня. withSleep — посчитана уже с оценкой сна. */
export interface StoredNorm {
  value: number;
  withSleep: boolean;
}

/**
 * Норма дня считается один раз: как только появилась оценка сна, либо при первом расчёте дня,
 * если сна нет. Дальше в течение дня не меняется. Посчитанная без сна пересчитывается
 * один раз, когда сон появится. Для прошлого дня без сохранённой нормы — по данным до него.
 */
export function resolveStepNorm(
  stored: StoredNorm | undefined,
  history: readonly number[],
  sleepScore: number | null,
): StoredNorm {
  if (stored && (stored.withSleep || sleepScore === null)) return stored;
  return { value: stepNorm(history, sleepScore), withSleep: sleepScore !== null };
}
