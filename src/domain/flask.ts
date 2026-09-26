/**
 * Колба «Цикла питания»: три слоя — «Переработка», «Жиросжигание», «Аутофагия».
 *
 * Уровень воды считается по ночной и дневной глюкозе кольца. Личные константы берутся
 * за последние семь дней: G_mid (среднее суточных средних), G_min (среднее двух-трёх
 * самых низких точек каждого дня) и N (сколько часов обычно проходит от пика еды до
 * возвращения глюкозы к G_mid). У нового пользователя — значения по умолчанию.
 *
 * Дальше по каждой пришедшей точке: глюкоза выше G_mid — человек поел, отсчёт сбрасывается
 * и колба пустеет. Ниже G_mid — время идёт: первый слой наполняется за N часов, второй за
 * следующие десять (тем быстрее, чем ниже держится сахар), третий — асимптотически, с учётом
 * дневной активности, и до краёв не доходит никогда.
 *
 * Подъём во сне (часто перед пробуждением) и на интенсивной нагрузке — не еда (`markNotMeal`,
 * glucose.ts; решение владельца 26.09): такой замер отсчёт не сбрасывает, и по нему не судим о том,
 * сколько сахар обычно возвращается после еды.
 */
import { markNotMeal, type NotMealContext } from './glucose';

/** Значения для нового пользователя, пока своих данных мало. */
export const FLASK_DEFAULT_G_MID = 5.5;
export const FLASK_DEFAULT_G_MIN = 4.3;
/** Сколько часов по умолчанию занимает возврат к среднему после еды: своих замеров ещё нет. */
export const FLASK_DEFAULT_N_HOURS = 3;
/** Разумные границы для личного N, чтобы одиночный странный день не сломал шкалу. */
export const FLASK_N_LIMITS = { min: 1, max: 6 } as const;
/** Сколько самых низких точек дня берём для G_min. */
export const FLASK_LOW_POINTS = 3;
/** Минимальный разброс G_mid − G_min: иначе коэффициент делился бы почти на ноль. */
export const FLASK_MIN_SPREAD = 0.3;

/** Доля колбы на каждый из трёх слоёв, %. */
export const FLASK_LAYER = 33;
/** Сколько часов после N наполняется средний слой. */
export const FLASK_FAT_HOURS = 10;
/** Границы коэффициента эффективности. */
export const FLASK_E_LIMITS = { min: 0.5, max: 1.2 } as const;
/** Верхний слой: к чему стремится уровень и как быстро. 66 + 29 = 95 — до краёв не доходит. */
export const FLASK_TOP_GAIN = 29;
export const FLASK_TOP_K = 0.2;
/** Активность за сутки ускоряет верхний слой: M = 1 + ккал / 2000. */
export const FLASK_CALORIES_DIVISOR = 2000;

export type FlaskStage = 'processing' | 'fat' | 'autophagy';

/** Подписи справа от колбы, снизу вверх. */
export const FLASK_STAGE_TEXT: Record<FlaskStage, string> = {
  processing: 'Переработка',
  fat: 'Жиросжигание',
  autophagy: 'Аутофагия',
};

export interface FlaskStats {
  gMid: number;
  gMin: number;
  nHours: number;
}

export interface GlucosePoint {
  /** Минуты на оси сегодняшнего дня: вчерашний вечер — отрицательные. */
  m: number;
  v: number;
}

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Личные константы по дням недели. День — массив замеров глюкозы (минуты суток и значения).
 * Дней без замеров в расчёте нет; совсем нет данных — значения по умолчанию.
 */
export function flaskStats(
  days: readonly (readonly GlucosePoint[])[],
  notMeal: readonly (NotMealContext | null)[] = [],
): FlaskStats {
  const withData = days.filter((d) => d.length > 0);
  const dailyMeans = withData.map((d) => mean(d.map((p) => p.v)));
  const dailyLows = withData.map((d) =>
    mean([...d.map((p) => p.v)].sort((a, b) => a - b).slice(0, FLASK_LOW_POINTS)),
  );
  const gMid = dailyMeans.length ? mean(dailyMeans) : FLASK_DEFAULT_G_MID;
  const gMinRaw = dailyLows.length ? mean(dailyLows) : FLASK_DEFAULT_G_MIN;
  // Разброс не должен схлопываться: на него делится коэффициент эффективности.
  const gMin = Math.min(gMinRaw, gMid - FLASK_MIN_SPREAD);
  // Подъёмы во сне и на нагрузке — не еда: из них не судим, как долго сахар возвращается после еды.
  const meals = days
    .map((d, i) => mealPoints(d, notMeal[i] ?? null, gMid))
    .filter((d) => d.length > 0);
  return { gMid, gMin, nHours: returnHours(meals, gMid) };
}

/** Замеры без высоких «не от еды» (`markNotMeal`): только они могут значить «поел». */
export function mealPoints(points: readonly GlucosePoint[], ctx: NotMealContext | null, gMid: number): GlucosePoint[] {
  if (!ctx) return [...points];
  return markNotMeal(points, ctx, (v) => v >= gMid, gMid)
    .filter((p) => p.notMeal === null)
    .map(({ m, v }) => ({ m, v }));
}

/**
 * N — среднее время от пика еды до падения к G_mid. Ищем участки, где глюкоза держалась
 * не ниже G_mid: от самой высокой точки участка до первого замера ниже G_mid.
 */
function returnHours(days: readonly (readonly GlucosePoint[])[], gMid: number): number {
  const spans: number[] = [];
  for (const day of days) {
    const points = [...day].sort((a, b) => a.m - b.m);
    let peak: GlucosePoint | null = null;
    for (const point of points) {
      if (point.v >= gMid) {
        if (!peak || point.v > peak.v) peak = point;
      } else if (peak) {
        spans.push((point.m - peak.m) / 60);
        peak = null;
      }
    }
  }
  const usable = spans.filter((h) => h > 0);
  if (!usable.length) return FLASK_DEFAULT_N_HOURS;
  return Math.min(FLASK_N_LIMITS.max, Math.max(FLASK_N_LIMITS.min, mean(usable)));
}

/** Коэффициент эффективности: чем ниже держится сахар, тем быстрее идёт процесс. */
export function efficiency(glucose: number, stats: FlaskStats): number {
  const spread = Math.max(FLASK_MIN_SPREAD, stats.gMid - stats.gMin);
  return Math.min(FLASK_E_LIMITS.max, Math.max(FLASK_E_LIMITS.min, (stats.gMid - glucose) / spread));
}

export interface FlaskView {
  stage: FlaskStage;
  /** Уровень воды, 0–95 %. */
  fill: number;
  /** Часов с тех пор, как глюкоза упала ниже среднего. */
  hours: number;
  /** Эффективные часы верхнего слоя: время с поправкой на сахар и активность. */
  effectiveHours: number;
  /** Последняя известная глюкоза. */
  glucose: number;
}

export interface FlaskInput {
  /** Замеры глюкозы за вчера и сегодня на оси сегодняшнего дня, по возрастанию минут. */
  points: readonly GlucosePoint[];
  nowMinute: number;
  stats: FlaskStats;
  /** Активные калории за сегодня; null — без надбавки за активность. */
  calories: number | null;
  /** Сон и интенсивная нагрузка на той же оси: подъём там — не еда. Нет — любой подъём считается едой. */
  notMeal?: NotMealContext;
}

/**
 * Уровень колбы на «сейчас». Замеров нет — колбы нет.
 * Слои: 0–33 «Переработка», 33–66 «Жиросжигание», 66–95 «Аутофагия».
 */
export function flaskState(input: FlaskInput): FlaskView | null {
  const { stats } = input;
  const known = input.points.filter((p) => p.m <= input.nowMinute);
  // Высокий замер во сне или на нагрузке пропускаем целиком: он не сбрасывает отсчёт и не задаёт
  // «текущий сахар» для скорости наполнения — им остаётся последний замер, который мог быть едой.
  const points = mealPoints(known, input.notMeal ?? null, stats.gMid).sort((a, b) => a.m - b.m);
  if (!points.length) return null;
  const last = points[points.length - 1];

  // Глюкоза выше среднего — человек поел: отсчёт с нуля, колба пустая.
  if (last.v >= stats.gMid) {
    return { stage: 'processing', fill: 0, hours: 0, effectiveHours: 0, glucose: last.v };
  }

  // Момент падения ниже среднего: первая точка после последнего «сытого» замера.
  const above = points.map((p) => p.v >= stats.gMid).lastIndexOf(true);
  const dropAt = above >= 0 ? points[above + 1].m : points[0].m;
  const hours = (input.nowMinute - dropAt) / 60;
  const base = { hours, glucose: last.v };

  if (hours <= stats.nHours) {
    const fill = Math.min(FLASK_LAYER, (hours / stats.nHours) * FLASK_LAYER);
    return { ...base, stage: 'processing', fill, effectiveHours: 0 };
  }

  if (hours <= stats.nHours + FLASK_FAT_HOURS) {
    const e = efficiency(last.v, stats);
    const grown = ((hours - stats.nHours) / FLASK_FAT_HOURS) * FLASK_LAYER * e;
    return { ...base, stage: 'fat', fill: FLASK_LAYER + Math.min(FLASK_LAYER, grown), effectiveHours: 0 };
  }

  // Верхний слой: складываем эффективное время по замерам — каждый со своим коэффициентом.
  const mAct = 1 + (input.calories ?? 0) / FLASK_CALORIES_DIVISOR;
  const startedAt = dropAt + (stats.nHours + FLASK_FAT_HOURS) * 60;
  let effectiveHours = 0;
  let previous = startedAt;
  for (const point of points.filter((p) => p.m > startedAt)) {
    effectiveHours += ((point.m - previous) / 60) * efficiency(point.v, stats) * mAct;
    previous = point.m;
  }
  // Хвост от последнего замера до «сейчас» — по последнему известному сахару.
  effectiveHours += ((input.nowMinute - previous) / 60) * efficiency(last.v, stats) * mAct;
  const fill = 2 * FLASK_LAYER + FLASK_TOP_GAIN * (1 - Math.exp(-FLASK_TOP_K * effectiveHours));
  return { ...base, stage: 'autophagy', fill, effectiveHours };
}
