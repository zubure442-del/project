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

/**
 * Наглядная мера сожжённого: один кусок пиццы. Число круглое и намеренно грубое —
 * это не пищевая ценность конкретной пиццы, а понятная единица «сколько это примерно».
 */
export const KCAL_PER_PIZZA_SLICE = 250;

/** Сколько кусков пиццы «стоит» такой расход: дробно, для частично закрашенного куска. */
export const pizzaSlices = (kcal: number): number => kcal / KCAL_PER_PIZZA_SLICE;

/**
 * Насколько человек двигался за неделю — относительно его базового обмена и цели.
 *
 * Коридор активных калорий в день считается долей базового обмена (Mifflin–St Jeor, `bmr`),
 * а сама доля зависит от цели из профиля. Ниже коридора — двигался мало, выше — слишком много:
 * при верно выбранной цели перебор так же мешает, как и недобор.
 */
export type ActivityGoal = 'lose' | 'gain' | 'keep';

/** Доли базового обмена: сколько активных калорий в день ждём при каждой цели. */
export const ACTIVITY_CORRIDOR: Record<ActivityGoal, { from: number; to: number }> = {
  lose: { from: 0.3, to: 0.45 },
  keep: { from: 0.2, to: 0.35 },
  gain: { from: 0.15, to: 0.25 },
};

export type ActivityLevel = 'low' | 'ideal' | 'high';

/** Подписи под расходом за неделю. «Идеальная» — зелёная, остальные — красные. */
export const ACTIVITY_LEVEL_TEXT: Record<ActivityLevel, string> = {
  low: 'Низкая активность',
  ideal: 'Идеальная активность',
  high: 'Высокая активность',
};

/** Куда попал средний дневной расход относительно коридора цели. */
export function activityLevel(perDay: number, body: Body, goal: ActivityGoal): ActivityLevel {
  const corridor = ACTIVITY_CORRIDOR[goal];
  const base = bmr(body);
  if (perDay < base * corridor.from) return 'low';
  if (perDay > base * corridor.to) return 'high';
  return 'ideal';
}

/** Оценка недели и то, из чего она получилась: средний расход и коридор цели, ккал в день. */
export interface WeekActivity {
  level: ActivityLevel;
  perDay: number;
  from: number;
  to: number;
}

type WeekActivityInput = {
  days: readonly { date: string; value: number | null }[];
  today: string;
  body: Body | null;
  goal: ActivityGoal | null;
};

/**
 * Оценка недели: средний расход по ЗАВЕРШЁННЫМ дням (сегодняшний ещё идёт и среднее занижает).
 * Нет биометрии, цели или ни одного завершённого дня с расходом — оценки нет.
 */
export function weekActivity(input: WeekActivityInput): WeekActivity | null {
  if (!input.body || input.goal === null) return null;
  const done = input.days.filter((d) => d.date < input.today && d.value !== null).map((d) => d.value as number);
  if (!done.length) return null;
  const perDay = done.reduce((a, b) => a + b, 0) / done.length;
  const corridor = ACTIVITY_CORRIDOR[input.goal];
  const base = bmr(input.body);
  return {
    level: activityLevel(perDay, input.body, input.goal),
    perDay,
    from: base * corridor.from,
    to: base * corridor.to,
  };
}

export const weekActivityLevel = (input: WeekActivityInput): ActivityLevel | null => weekActivity(input)?.level ?? null;

/**
 * Где стоит средний расход на шкале «мало — идеально — много», 0–1. У шкалы три равные части:
 * до коридора, сам коридор и после него (до двойной верхней границы); внутри части — линейно.
 * Равные части — чтобы зелёная середина читалась одинаково при любой цели.
 */
export function corridorPosition(perDay: number, from: number, to: number): number {
  const third = 1 / 3;
  if (perDay < from) return (Math.max(0, perDay) / from) * third;
  if (perDay <= to) return third + ((perDay - from) / Math.max(1, to - from)) * third;
  return 2 * third + Math.min(1, (perDay - to) / to) * third;
}
