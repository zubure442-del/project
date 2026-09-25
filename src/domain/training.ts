import type { ActivityGoal } from './calories';
import { loadIntervals } from './charts';
import { maxHeartRate } from './score';

/**
 * Тренировка дня для «Пика выносливости» — по тому же принципу, что у Garmin (Daily Suggested
 * Workouts): готовность организма сегодня + баланс нагрузки последних недель + цель профиля.
 * - Нагрузка дня — TRIMP по Эдвардсу: минуты в каждой пульсовой зоне × номер зоны.
 * - Безопасный рост нагрузки — отношение средней нагрузки последней недели к привычной (4 недели):
 *   коридор 0.8–1.3 (Gabbett, 2016); выше — нагрузку не наращиваем.
 * - Тяжёлое чередуется с лёгким: после тяжёлого дня — не тяжелее средней тренировки.
 * - Силовые — не чаще, чем мышцы успевают восстановиться (48 часов), хотя бы раз в неделю при любой цели.
 * Пульсовые зоны — личные: по формуле Карвонена от пульса покоя и максимального пульса (208 − 0.7 × возраст).
 */

/** Границы пяти пульсовых зон — доля резерва пульса (или максимального, если пульс покоя неизвестен). */
export const HR_ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
export type HrZone = 1 | 2 | 3 | 4 | 5;

/** Пульс на доле `share` резерва: Карвонен, если известен пульс покоя, иначе доля максимального. */
export function pulseAtShare(share: number, age: number, restingHr: number | null): number {
  const max = maxHeartRate(age);
  return Math.round(restingHr === null ? share * max : restingHr + share * (max - restingHr));
}

/** Пульс «от–до» зоны. */
export function zoneRange(zone: HrZone, age: number, restingHr: number | null): [number, number] {
  return [pulseAtShare(HR_ZONE_BOUNDS[zone - 1], age, restingHr), pulseAtShare(HR_ZONE_BOUNDS[zone], age, restingHr)];
}

/** Номер зоны пульса; ниже первой — 0 (обычная жизнь, не тренировка). */
export function zoneOf(pulse: number, age: number, restingHr: number | null): 0 | HrZone {
  let zone: 0 | HrZone = 0;
  for (let z = 1; z <= 5; z++) if (pulse >= pulseAtShare(HR_ZONE_BOUNDS[z - 1], age, restingHr)) zone = z as HrZone;
  return zone;
}

/** Один замер покрывает время до следующего, но не больше этого (период автозамера). */
export const LOAD_SAMPLE_COVER_MIN = 30;
/** Тренировка — эпизод нагрузки не короче этого, с пульсом хотя бы в третьей зоне. */
export const SESSION_MIN_MINUTES = 15;
export const SESSION_MIN_ZONE: HrZone = 3;
/** Шагов в минуту в среднем за эпизод — с этого тренировка считается кардио (ходьба, бег), ниже — силовой. */
export const CARDIO_STEPS_PER_MIN = 60;

export interface DayLoad {
  /** TRIMP: минуты в зоне × номер зоны. */
  trimp: number;
  /** Минуты по интенсивности: лёгкая аэробная (зоны 1–2), высокая аэробная (3–4), анаэробная (5). */
  low: number;
  high: number;
  anaerobic: number;
  /** Главная тренировка дня: кардио (много шагов) или силовая (пульс высокий, шагов мало). */
  session: 'cardio' | 'strength' | null;
}

/**
 * Нагрузка дня по пульсу и шагам (минуты — от полуночи дня). Возраст неизвестен — null:
 * без максимального пульса зон нет.
 */
export function dayLoad(
  heart: readonly { m: number; v: number }[],
  steps: readonly { m: number; v: number }[],
  age: number | null,
  restingHr: number | null,
): DayLoad | null {
  if (age === null) return null;
  const sorted = [...heart].sort((a, b) => a.m - b.m);
  const minutes = [0, 0, 0, 0, 0, 0];
  sorted.forEach((p, i) => {
    const next = sorted[i + 1];
    const cover = next ? Math.min(next.m - p.m, LOAD_SAMPLE_COVER_MIN) : LOAD_SAMPLE_COVER_MIN;
    minutes[zoneOf(p.v, age, restingHr)] += cover;
  });
  const trimp = minutes.reduce((sum, m, zone) => sum + m * zone, 0);

  const sessionPulse = pulseAtShare(HR_ZONE_BOUNDS[SESSION_MIN_ZONE - 1], age, restingHr);
  const sessions = loadIntervals([...heart], age, [...steps], restingHr).filter(
    (e) => e.to - e.from >= SESSION_MIN_MINUTES && e.peak !== null && e.peak >= sessionPulse,
  );
  const main = [...sessions].sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0))[0];
  const session = main ? (main.steps / (main.to - main.from + 1) >= CARDIO_STEPS_PER_MIN ? 'cardio' : 'strength') : null;

  return {
    trimp: Math.round(trimp),
    low: minutes[1] + minutes[2],
    high: minutes[3] + minutes[4],
    anaerobic: minutes[5],
    session,
  };
}

/** Какую тренировку предложить. */
export type WorkoutKind =
  | 'recovery'
  | 'base'
  | 'tempo'
  | 'threshold'
  | 'intervals'
  | 'strength'
  | 'hypertrophy'
  | 'circuit'
  | 'mobility';

/** Готовность организма сегодня — из шагов 2–4 «Пика выносливости». */
export type Readiness = 'high' | 'moderate' | 'low' | 'recovery';

export interface WorkoutInput {
  readiness: Readiness;
  goal: ActivityGoal | null;
  /** Нагрузка прошлых дней (сегодня не входит), по датам. */
  history: readonly { date: string; load: DayLoad }[];
  today: string;
  age: number | null;
  restingHr: number | null;
  /** Длина окна пика, минуты: тренировка в него помещается. */
  windowMin: number;
}

export interface WorkoutPlan {
  kind: WorkoutKind;
  title: string;
  /** Целевая зона пульса — у кардио; у силовых и растяжки null. */
  zone: HrZone | null;
  /** Пульс «от–до» в целевой зоне; возраст неизвестен — null. */
  pulse: [number, number] | null;
  /** Длительность «от–до», минуты. */
  minutes: [number, number];
  /** Подходы и повторения у силовых: «3–4 × 8–12» и подпись. */
  sets: { value: string; caption: string } | null;
}

export const WORKOUT: Record<
  WorkoutKind,
  { title: string; zone: HrZone | null; minutes: [number, number]; sets?: { value: string; caption: string } }
> = {
  recovery: { title: 'Восстановительная', zone: 1, minutes: [20, 30] },
  base: { title: 'Базовая аэробная', zone: 2, minutes: [40, 60] },
  tempo: { title: 'Темповая', zone: 3, minutes: [30, 45] },
  threshold: { title: 'Пороговая', zone: 4, minutes: [30, 40] },
  intervals: { title: 'Интервалы на МПК', zone: 5, minutes: [25, 35] },
  strength: { title: 'Силовая', zone: null, minutes: [45, 60], sets: { value: '4–5 × 3–6', caption: 'подходы × повторения' } },
  hypertrophy: {
    title: 'Тренировка на массу',
    zone: null,
    minutes: [45, 60],
    sets: { value: '3–4 × 8–12', caption: 'подходы × повторения' },
  },
  circuit: { title: 'Круговая', zone: null, minutes: [30, 40], sets: { value: '3 × 12–15', caption: 'круги × повторения' } },
  mobility: { title: 'Мобильность и растяжка', zone: null, minutes: [15, 25] },
};

/** Нагрузка последней недели к привычной: коридор безопасного роста и его края. */
export const ACWR_LOW = 0.8;
export const ACWR_HIGH = 1.3;
export const ACWR_DANGER = 1.5;
/** Острое окно — неделя, привычное — четыре; привычное считаем, если данных хотя бы за две недели. */
export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;
export const CHRONIC_MIN_DAYS = 14;
/** Вчера тяжело — нагрузка в полтора раза выше привычной за день. */
export const HARD_DAY_RATIO = 1.5;
/** Высокой интенсивности (зоны 3–5) в полезной нагрузке — около пятой части (модель 80/20). */
export const HIGH_INTENSITY_SHARE = 0.2;
/** Для интервалов нужна база: хотя бы столько тренировок за две недели, иначе начинаем с базовой. */
export const BASE_SESSIONS_FOR_KEY = 2;
export const BASE_SESSIONS_FOR_INTERVALS = 4;

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Нагрузка последней недели к привычной; мало истории — null. */
export function loadRatio(history: WorkoutInput['history'], today: string): number | null {
  const within = (days: number) => history.filter((h) => h.date < today && h.date >= shiftDate(today, -days));
  const chronic = within(CHRONIC_DAYS);
  if (chronic.length < CHRONIC_MIN_DAYS) return null;
  const chronicMean = mean(chronic.map((h) => h.load.trimp));
  if (chronicMean <= 0) return null;
  // Дни без данных в неделе считаем днями без тренировок только внутри уже известной истории.
  return mean(within(ACUTE_DAYS).map((h) => h.load.trimp)) / chronicMean;
}

export function workoutPlan(input: WorkoutInput): WorkoutPlan {
  const { history, today, goal } = input;
  const past = [...history].filter((h) => h.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const yesterday = past.find((h) => h.date === shiftDate(today, -1)) ?? null;
  const twoWeeks = past.filter((h) => h.date >= shiftDate(today, -14));
  const sessions = twoWeeks.filter((h) => h.load.session !== null);
  const lastSession = past.find((h) => h.load.session !== null) ?? null;

  // Уровень: 3 — ключевая тренировка, 2 — средняя, 1 — лёгкая.
  let level = input.readiness === 'high' ? 3 : input.readiness === 'moderate' ? 2 : 1;
  const ratio = loadRatio(history, today);
  if (ratio !== null && ratio > ACWR_HIGH) level = Math.min(level, 2);
  if (ratio !== null && ratio >= ACWR_DANGER) level = 1;
  const chronicMean = mean(past.filter((h) => h.date >= shiftDate(today, -CHRONIC_DAYS)).map((h) => h.load.trimp));
  if (yesterday && chronicMean > 0 && yesterday.load.trimp >= HARD_DAY_RATIO * chronicMean) level = Math.min(level, 2);

  // Вид: по цели и по тому, чем человек занимался в последний раз. Тренировок в данных нет —
  // по расписанию: при похудении силовая раз в три дня, при поддержании — через день.
  const weekAgo = shiftDate(today, -7);
  const strengthRecently = past.some((h) => h.date >= weekAgo && h.load.session === 'strength');
  const strengthYesterday = yesterday?.load.session === 'strength';
  const recentSession = lastSession && lastSession.date >= weekAgo ? lastSession : null;
  const dayIndex = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  let modality: 'cardio' | 'strength';
  if (goal === 'gain') modality = strengthYesterday ? 'cardio' : 'strength';
  else if (strengthYesterday || (strengthRecently && goal === 'lose')) modality = 'cardio';
  else if (goal === 'lose') modality = sessions.length ? (level >= 2 ? 'strength' : 'cardio') : dayIndex % 3 === 0 ? 'strength' : 'cardio';
  else if (recentSession) modality = recentSession.load.session === 'cardio' ? 'strength' : 'cardio';
  else modality = dayIndex % 2 === 0 ? 'strength' : 'cardio';

  // Тяжёлая силовая («4–5 × 3–6») — только тем, кто уже регулярно делает силовые.
  const strengthSessions = twoWeeks.filter((h) => h.load.session === 'strength').length;
  let kind: WorkoutKind;
  if (input.readiness === 'recovery') kind = 'recovery';
  else if (modality === 'strength') {
    if (level === 1) kind = 'mobility';
    else if (level === 2 || goal === 'lose') kind = 'circuit';
    else kind = goal !== 'gain' && strengthSessions >= BASE_SESSIONS_FOR_KEY ? 'strength' : 'hypertrophy';
  } else if (level === 1) kind = 'recovery';
  else if (level === 2 || sessions.length < BASE_SESSIONS_FOR_KEY) kind = 'base';
  else {
    // Ключевая: чего не хватает в последние две недели — как «фокус нагрузки» у Garmin.
    const total = twoWeeks.reduce((sum, h) => sum + h.load.low + h.load.high + h.load.anaerobic, 0);
    const intense = twoWeeks.reduce((sum, h) => sum + h.load.high + h.load.anaerobic, 0);
    const underloaded = ratio !== null && ratio < ACWR_LOW;
    if (underloaded && sessions.length >= BASE_SESSIONS_FOR_INTERVALS) kind = 'intervals';
    else if (total === 0 || intense / total < HIGH_INTENSITY_SHARE) kind = 'threshold';
    else kind = 'tempo';
  }

  const spec = WORKOUT[kind];
  const hi = Math.max(10, Math.min(spec.minutes[1], input.windowMin));
  const lo = Math.min(spec.minutes[0], hi);
  return {
    kind,
    title: spec.title,
    zone: spec.zone,
    pulse: spec.zone !== null && input.age !== null ? zoneRange(spec.zone, input.age, input.restingHr) : null,
    minutes: [lo, hi],
    sets: spec.sets ?? null,
  };
}
