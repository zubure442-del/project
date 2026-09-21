/**
 * Шумоподавление шагов: кольцо засчитывает лишние шаги от движений рукой.
 * Применяется только к ДНЕВНОЙ СУММЕ (число шагов за день, точка недели, норма, оценка, дистанция).
 * Почасовой график «День» показывает сырые шаги: коэффициент для суммы к отдельным часам неприменим.
 */
export const STEP_NOISE_LOW_MAX = 1500;
export const STEP_NOISE_MID_MAX = 5000;
export const STEP_NOISE_HIGH_MAX = 7000;
export const STEP_NOISE_K1 = 0.6;
export const STEP_NOISE_K2 = 0.72;
/** В диапазоне 5001–7000 вычитаем от 1400 до 2000, линейно. */
export const STEP_NOISE_RAMP_FROM = 1400;
export const STEP_NOISE_RAMP_ADD = 600;
export const STEP_NOISE_FLAT_PENALTY = 2000;

export function applyStepNoise(rawSteps: number): number {
  let clean: number;
  if (rawSteps <= STEP_NOISE_LOW_MAX) clean = rawSteps * STEP_NOISE_K1;
  else if (rawSteps <= STEP_NOISE_MID_MAX) clean = rawSteps * STEP_NOISE_K2;
  else if (rawSteps <= STEP_NOISE_HIGH_MAX) {
    const share = (rawSteps - STEP_NOISE_MID_MAX) / (STEP_NOISE_HIGH_MAX - STEP_NOISE_MID_MAX);
    clean = rawSteps - (STEP_NOISE_RAMP_FROM + share * STEP_NOISE_RAMP_ADD);
  } else clean = rawSteps - STEP_NOISE_FLAT_PENALTY;
  return Math.max(0, Math.round(clean));
}
