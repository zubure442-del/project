import { dateKey, nowRingTs, wallClock } from '../codec/time';
import type { DayRaw, RawByDay } from '../storage/raw';

/**
 * Демо-режим: синтетические ВТОРОСТЕПЕННЫЕ показатели — ряды того же вида, что хранятся после
 * выгрузки кольца (`RawByDay`): фазы сна по минутам, шаги по минутам, пульс, замеры 0x55
 * (давление, стресс, глюкоза, вариабельность) и кислород. Сон, Активность, Организм и итог
 * здесь не появляются: их считает тот же код, что и для кольца (`rebuildDays`).
 * Чистые функции: одно и то же зерно и время дают одни и те же ряды.
 */
export const DEMO = {
  /** Сколько дней генерируем: неделя на экране и неделя истории для нормы шагов, ориентиров и постоянства сна. */
  historyDays: 14,
  /** Период замеров пульса, 0x55 и кислорода — как у автозамера кольца. */
  measureEveryMin: 30,
  /** Подъём, минуты от полуночи: 6:15–7:50. */
  wakeMin: [375, 470],
  /** Обычная ночь: длительность сна в минутах и доля глубокого. */
  nightMin: [390, 490],
  deepShare: [0.15, 0.24],
  /** Короткая ночь: доля таких ночей, длительность и доля глубокого. */
  shortNightShare: 0.2,
  shortNightMin: [250, 330],
  shortDeepShare: [0.07, 0.12],
  /** Доля ночей с одним коротким пробуждением на 15 минут. */
  awakeBlockShare: 0.5,
  /** Шагов за день до шумоподавления; из них — мелкими движениями вне прогулок. */
  stepsPerDay: [5000, 13000],
  backgroundSteps: [1200, 2200],
  /** Темп ходьбы, шагов в минуту. */
  walkCadence: [95, 115],
  /** Тренировка вечером: доля дней, длительность, шагов в минуту, пульс. */
  workoutShare: 0.3,
  workoutMin: [45, 60],
  workoutCadence: [15, 40],
  workoutHr: [128, 148],
  /** Пульс: во сне, в покое днём, прибавка при ходьбе, прибавка сразу после тренировки. */
  sleepHr: [50, 58],
  restHr: [66, 78],
  walkHrRise: [14, 24],
  recoveryHrRise: [18, 24],
  /** Ограничение скачка между соседними замерами вне тренировки: фильтр выбросов его не тронет. */
  maxHrStep: 27,
  /** Вариабельность, мс: ночью и днём; после короткой ночи — ниже. */
  hrvNight: [52, 72],
  hrvDay: [34, 50],
  shortNightHrvFactor: 0.85,
  stressNight: [8, 25],
  stressDay: [22, 55],
  stressWalk: [35, 60],
  systolic: [108, 126],
  diastolic: [68, 81],
  /** Глюкоза, ммоль/л, и прибавка в течение часа после еды (8:00, 13:00, 19:00). */
  glucose: [4.7, 5.3],
  glucoseMealRise: 0.3,
  mealsMin: [480, 780, 1140],
  spo2Day: [95, 99],
  spo2Night: [94, 98],
} as const;

type Range = readonly [number, number];
type Rng = () => number;

/** Детерминированный генератор (mulberry32). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Свой поток случайных чисел на день и на вид данных: сегодняшний «обрез» по времени не сдвигает остальное. */
const rngFor = (seed: number, date: string, stream: number) =>
  mulberry32(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(dayNumber(date), 0xc2b2ae35) ^ Math.imul(stream + 1, 0x27d4eb2f));

const uniform = (rng: Rng, [from, to]: Range) => from + rng() * (to - from);
const int = (rng: Rng, range: Range) => Math.round(uniform(rng, range));
const clampTo = (x: number, [from, to]: Range) => Math.min(to, Math.max(from, x));

interface Span {
  from: number;
  to: number;
}

interface DayPlan {
  /** Начало ночи, закончившейся в этот день: минуты от полуночи, вечер накануне — отрицательные. */
  bedtime: number;
  wake: number;
  short: boolean;
  /** Состояние сна на каждые 15 минут ночи: 0 — бодрствование, 1–79 — лёгкий, 80–99 — глубокий. */
  blocks: number[];
  walks: (Span & { cadence: number })[];
  workout: (Span & { cadence: number }) | null;
  backgroundSteps: number;
  sleepHr: number;
  hrvFactor: number;
  glucoseBase: number;
}

const BLOCK_MIN = 15;
const CYCLE_BLOCKS = 6;

/** Ночь по 15-минутным блокам: глубокий сон — в первых циклах, как у настоящей ночи. */
function nightBlocks(rng: Rng, count: number, deepShare: number): number[] {
  const deep = Math.max(1, Math.round(count * deepShare));
  const stages: ('light' | 'deep' | 'awake')[] = new Array(count).fill('light');
  let placed = 0;
  for (let offset = 1; offset < CYCLE_BLOCKS - 1 && placed < deep; offset++) {
    for (let cycle = 0; cycle * CYCLE_BLOCKS + offset < count && placed < deep; cycle++) {
      stages[cycle * CYCLE_BLOCKS + offset] = 'deep';
      placed++;
    }
  }
  if (rng() < DEMO.awakeBlockShare && count > 8) {
    const at = Math.floor(count / 2) + Math.floor(rng() * (count / 2 - 1));
    if (stages[at] === 'light') stages[at] = 'awake';
  }
  return stages.map((s) => (s === 'deep' ? int(rng, [82, 99]) : s === 'light' ? int(rng, [15, 60]) : 0));
}

function planFor(seed: number, date: string): DayPlan {
  const rng = rngFor(seed, date, 0);
  const short = rng() < DEMO.shortNightShare;
  const wake = Math.round(uniform(rng, DEMO.wakeMin) / 5) * 5;
  const sleepMin = Math.round(uniform(rng, short ? DEMO.shortNightMin : DEMO.nightMin) / BLOCK_MIN) * BLOCK_MIN;
  const blocks = nightBlocks(rng, sleepMin / BLOCK_MIN, uniform(rng, short ? DEMO.shortDeepShare : DEMO.deepShare));
  const bedtime = wake - blocks.length * BLOCK_MIN;

  const cadence = () => int(rng, DEMO.walkCadence);
  const morning = { from: wake + int(rng, [30, 70]), len: int(rng, [12, 25]), cadence: cadence() };
  const lunch = { from: int(rng, [740, 790]), len: int(rng, [10, 20]), cadence: cadence() };
  const extra = rng() < 0.5 ? { from: int(rng, [900, 990]), len: int(rng, [10, 20]), cadence: cadence() } : null;
  const evening = { from: int(rng, [1080, 1170]), len: 0, cadence: cadence() };
  // Вечерняя прогулка добирает дневную цель шагов.
  const target = int(rng, DEMO.stepsPerDay);
  const background = int(rng, DEMO.backgroundSteps);
  const fixed = [morning, lunch, extra].reduce((sum, w) => sum + (w ? w.len * w.cadence : 0), 0);
  evening.len = Math.round(clampTo((target - background - fixed) / evening.cadence, [15, 110]));
  const walks = [morning, lunch, extra, evening]
    .filter((w): w is NonNullable<typeof w> => w !== null)
    .map((w) => ({ from: w.from, to: w.from + w.len, cadence: w.cadence }));

  const hasWorkout = rng() < DEMO.workoutShare;
  const workoutStart = evening.from + evening.len + int(rng, [30, 60]);
  const workout = hasWorkout
    ? { from: workoutStart, to: workoutStart + int(rng, DEMO.workoutMin), cadence: int(rng, DEMO.workoutCadence) }
    : null;

  return {
    bedtime,
    wake,
    short,
    blocks,
    walks,
    workout,
    backgroundSteps: background,
    sleepHr: int(rng, DEMO.sleepHr),
    hrvFactor: uniform(rng, [0.9, 1.1]) * (short ? DEMO.shortNightHrvFactor : 1),
    glucoseBase: uniform(rng, DEMO.glucose),
  };
}

type Activity = 'sleep' | 'rest' | 'walk' | 'workout';

const inSpan = (m: number, spans: readonly Span[]) => spans.some((s) => m >= s.from && m < s.to);

/** Что человек делал в минуту m дня: по его ночи, следующей ночи, прогулкам и тренировке. */
function activityAt(plan: DayPlan, nextBedtime: number, m: number): Activity {
  if ((m >= plan.bedtime && m < plan.wake) || m >= nextBedtime) return 'sleep';
  if (plan.workout && m >= plan.workout.from && m < plan.workout.to) return 'workout';
  return inSpan(m, plan.walks) ? 'walk' : 'rest';
}

function generateDay(seed: number, date: string, until: number): DayRaw {
  const base = planFor(seed, date);
  // Следующая ночь начинается сегодня вечером: пульс и замеры после отхода ко сну — «ночные».
  const nextBedtime = planFor(seed, shiftDate(date, 1)).bedtime + 1440;
  // Тренировка, которая не успевает закончиться до сна, в этот день не состоялась.
  const workout = base.workout && base.workout.to + DEMO.measureEveryMin <= nextBedtime ? base.workout : null;
  const plan: DayPlan = { ...base, workout };
  const day: DayRaw = { date, steps: [], sleep: [], heart: [], summary: [], spo2: [] };

  // Сон: ночь целиком в дне пробуждения, минуты до полуночи — отрицательные (как в кэше кольца).
  // Кольцо отдаёт ночь только целиком, когда человек проснулся: незаконченной ночи в демо нет.
  if (plan.bedtime + plan.blocks.length * BLOCK_MIN <= until) {
    plan.blocks.forEach((state, i) => {
      for (let k = 0; k < BLOCK_MIN; k++) day.sleep.push([plan.bedtime + i * BLOCK_MIN + k, state]);
    });
  }

  // Шаги: прогулки и тренировка поминутно, остальное — мелкими движениями в часы бодрствования.
  const stepsRng = rngFor(seed, date, 1);
  const byMinute = new Map<number, number>();
  for (const w of [...plan.walks, ...(plan.workout ? [plan.workout] : [])]) {
    for (let m = w.from; m < w.to; m++) byMinute.set(m, Math.max(0, w.cadence + int(stepsRng, [-8, 8])));
  }
  const awakeEnd = Math.min(1439, nextBedtime - 1);
  let background = plan.backgroundSteps;
  while (background > 0) {
    const m = int(stepsRng, [plan.wake, awakeEnd]);
    if (byMinute.has(m)) continue;
    const v = Math.min(background, int(stepsRng, [3, 25]));
    byMinute.set(m, v);
    background -= v;
  }
  for (const [m, v] of [...byMinute].sort((a, b) => a[0] - b[0])) {
    if (m <= until && m < 1440 && v > 0) day.steps.push([m, v]);
  }

  // Замеры раз в 30 минут: пульс, 0x55 и кислород, как при автозамере кольца.
  const rng = rngFor(seed, date, 2);
  let prevHr = plan.sleepHr;
  let prevAct: Activity = 'sleep';
  /** Последний замер до тренировки и последний пульс покоя днём. */
  let calmHr = prevHr;
  let restHr = int(rng, DEMO.restHr);
  for (let slot = 0; slot < 1440 / DEMO.measureEveryMin; slot++) {
    const m = slot * DEMO.measureEveryMin + int(rng, [0, 3]);
    const act = activityAt(plan, nextBedtime, m);

    let hr: number;
    if (act === 'workout') hr = int(rng, DEMO.workoutHr);
    // Первый замер после тренировки — пульс ещё повышен: так фильтр выбросов не примет тренировку за сбой.
    else if (prevAct === 'workout') hr = calmHr + int(rng, DEMO.recoveryHrRise);
    else {
      const target =
        act === 'sleep' ? plan.sleepHr + int(rng, [-2, 3]) : act === 'walk' ? restHr + int(rng, DEMO.walkHrRise) : int(rng, DEMO.restHr);
      // Вне тренировки пульс меняется плавно: фильтр выбросов не должен ничего выкидывать.
      hr = clampTo(target, [prevHr - DEMO.maxHrStep, prevHr + DEMO.maxHrStep]);
      if (act === 'rest') restHr = hr;
    }
    if (act !== 'workout') calmHr = hr;
    prevHr = hr;
    prevAct = act;

    const night = act === 'sleep';
    const hrvRange = night ? DEMO.hrvNight : DEMO.hrvDay;
    const hrv = Math.round(uniform(rng, hrvRange) * plan.hrvFactor);
    const stress = int(rng, night ? DEMO.stressNight : act === 'rest' ? DEMO.stressDay : DEMO.stressWalk);
    const afterMeal = DEMO.mealsMin.some((meal) => m >= meal && m < meal + 60);
    const glucose = Math.round((plan.glucoseBase + (afterMeal ? DEMO.glucoseMealRise : 0) + uniform(rng, [-0.15, 0.15])) * 10);
    const systolic = int(rng, DEMO.systolic);
    const diastolic = Math.min(systolic - 30, int(rng, DEMO.diastolic));
    const spo2 = int(rng, night ? DEMO.spo2Night : DEMO.spo2Day);

    if (m > until) continue;
    day.heart.push([m, hr]);
    day.summary.push([m, systolic, diastolic, stress, glucose, hrv]);
    day.spo2.push([m, spo2]);
  }
  return day;
}

/**
 * Ряды за DEMO.historyDays дней, последний — сегодня; сегодняшние — только до текущей минуты.
 * Ночь относится ко дню пробуждения, как в настоящем кэше.
 */
export function generateDemoRaw(seed: number, now: Date): RawByDay {
  const nowTs = nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60);
  const today = dateKey(nowTs);
  const clock = wallClock(nowTs);
  const nowMinute = clock.hour * 60 + clock.minute;
  const out: RawByDay = {};
  for (let i = DEMO.historyDays - 1; i >= 0; i--) {
    const date = shiftDate(today, -i);
    out[date] = generateDay(seed, date, i === 0 ? nowMinute : Infinity);
  }
  return out;
}
