import { maxHeartRate } from './score';

/**
 * Активные калории за день (без базового обмена), по минутам, одним методом для всех дней.
 * В минуту берём большее из двух оценок — по шагам и по пульсу, — чтобы не считать дважды.
 */

/** Ходьба: ккал на килограмм веса на километр. */
export const WALK_KCAL_PER_KG_KM = 0.75;
/** Длина шага = доля роста. */
export const STRIDE_HEIGHT_RATIO = 0.415;
/** Пульс между замерами тянем линейно, только если между ними не больше этого. */
export const HR_INTERP_MAX_MIN = 20;
/** Пульс «в работе»: не ниже max(HR_ACTIVE_FLOOR, HR_ACTIVE_SHARE × максимальный пульс). */
export const HR_ACTIVE_FLOOR = 100;
export const HR_ACTIVE_SHARE = 0.5;
/** Keytel (2005) даёт кДж в минуту; в ккал — делим на это. */
export const KJ_PER_KCAL = 4.184;
export const KEYTEL = {
  male: { base: -55.0969, hr: 0.6309, weight: 0.1988, age: 0.2017 },
  female: { base: -20.4022, hr: 0.4472, weight: -0.1263, age: 0.074 },
} as const;
/** Базовый обмен по Mifflin–St Jeor: 10·вес + 6.25·рост − 5·возраст + (5 у мужчин, −161 у женщин). */
export const MIFFLIN = { weight: 10, height: 6.25, age: 5, male: 5, female: -161 } as const;
export const MINUTES_PER_DAY = 1440;

export interface Body {
  sex: 'male' | 'female';
  heightCm: number;
  weightKg: number;
  age: number;
}

/** Биометрия из профиля. Нет хотя бы одного поля — калории не считаем, умолчаний не подставляем. */
export function bodyOf(
  profile: { sex: 'male' | 'female' | null; heightCm: number | null; weightKg: number | null; birthYear: number | null },
  now = new Date(),
): Body | null {
  const { sex, heightCm, weightKg, birthYear } = profile;
  if (sex === null || heightCm === null || weightKg === null || birthYear === null) return null;
  return { sex, heightCm, weightKg, age: now.getFullYear() - birthYear };
}

/** Базовый обмен, ккал в сутки. */
export const bmr = (b: Body) =>
  MIFFLIN.weight * b.weightKg + MIFFLIN.height * b.heightCm - MIFFLIN.age * b.age + MIFFLIN[b.sex];

/** Ккал на шаг: 0.75 × вес × (0.415 × рост в метрах) / 1000. */
export const kcalPerStep = (b: Body) => (WALK_KCAL_PER_KG_KM * b.weightKg * (STRIDE_HEIGHT_RATIO * b.heightCm / 100)) / 1000;

/** Расход по пульсу (Keytel), ккал в минуту. */
export function keytel(b: Body, hr: number): number {
  const k = KEYTEL[b.sex];
  return (k.base + k.hr * hr + k.weight * b.weightKg + k.age * b.age) / KJ_PER_KCAL;
}

/** Порог «рабочего» пульса. */
export const activeHrThreshold = (b: Body) => Math.max(HR_ACTIVE_FLOOR, HR_ACTIVE_SHARE * maxHeartRate(b.age));

/** Пульс по минутам: сами замеры и линейная интерполяция между соседними, если разрыв не больше 20 минут. */
export function heartByMinute(points: readonly { m: number; v: number }[]): Map<number, number> {
  const sorted = [...points].sort((a, b) => a.m - b.m);
  const out = new Map<number, number>();
  sorted.forEach((p, i) => {
    out.set(Math.round(p.m), p.v);
    const next = sorted[i + 1];
    if (!next || next.m - p.m > HR_INTERP_MAX_MIN) return;
    for (let m = Math.round(p.m) + 1; m < Math.round(next.m); m++) {
      out.set(m, p.v + ((next.v - p.v) * (m - p.m)) / (next.m - p.m));
    }
  });
  return out;
}

/**
 * Активные ккал за день. По шагам: шаги минуты × ккал на шаг. По пульсу (если он «рабочий»):
 * Keytel минус базовый обмен на минуту. В минуту — большее из двух, сумма округляется.
 */
export function activeCalories(
  steps: readonly { m: number; v: number }[],
  heart: readonly { m: number; v: number }[],
  body: Body | null,
): number | null {
  if (!body) return null;
  const perStep = kcalPerStep(body);
  const threshold = activeHrThreshold(body);
  const restPerMin = bmr(body) / MINUTES_PER_DAY;
  const byStep = new Map<number, number>();
  for (const s of steps) byStep.set(Math.round(s.m), (byStep.get(Math.round(s.m)) ?? 0) + s.v * perStep);
  const byHr = new Map<number, number>();
  for (const [m, hr] of heartByMinute(heart)) {
    if (hr >= threshold) byHr.set(m, Math.max(0, keytel(body, hr) - restPerMin));
  }
  let total = 0;
  for (const m of new Set([...byStep.keys(), ...byHr.keys()])) total += Math.max(byStep.get(m) ?? 0, byHr.get(m) ?? 0);
  return Math.round(total);
}

/** Сумма за неделю: дни без значения не учитываются. Нет ни одного — null. */
export function weekCalories(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
