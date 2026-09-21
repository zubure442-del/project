/** Длина шага = доля роста. Дистанция на «Сегодня» считается от шагов после шумоподавления. */
export const STRIDE_COEFFICIENT = 0.414;
/** Меньше этого показываем метры, иначе километры с одной цифрой после точки. */
export const DISTANCE_KM_FROM_M = 1000;
/** Метры округляем до десятков: точнее шагомер всё равно не знает. */
export const DISTANCE_M_ROUND = 10;

export const distanceMeters = (cleanSteps: number, heightCm: number) => cleanSteps * (heightCm / 100) * STRIDE_COEFFICIENT;

/** «850 м» или «3.2 км». */
export function formatDistance(meters: number): string {
  if (meters < DISTANCE_KM_FROM_M) return `${Math.round(meters / DISTANCE_M_ROUND) * DISTANCE_M_ROUND} м`;
  return `${(meters / 1000).toFixed(1)} км`;
}
