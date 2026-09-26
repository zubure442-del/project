import { dateKey } from '../codec';
import { loadIntervals } from './charts';
import { median } from './food';
import { SLEEP_SESSION_GAP } from './sleep';
import { HR_ZONE_BOUNDS, SESSION_MIN_ZONE, pulseAtShare } from './training';

/**
 * Защита от случайных выбросов глюкозы ВВЕРХ (решение владельца 26.09, вторая версия).
 *
 * Кольцо иногда выдаёт одиночное высокое значение, которого не было: 5.1 → 6.9 → 5.4 ночью.
 * Настоящий подъём (после еды) так не выглядит: глюкоза растёт 30–60 минут и возвращается
 * к обычной за два-три часа, поэтому соседний замер через полчаса «примерно такой же».
 * Правило:
 * - замер выше своего обычного уровня и выше ОБОИХ соседей (предыдущего и следующего, не дальше
 *   GLUCOSE_NEIGHBOR_GAP_MIN) больше чем на скачок — GLUCOSE_JUMP_SHARE от обычного уровня, — выброс;
 * - предыдущего соседа нет (дальше двух часов) — вместо него обычный уровень;
 * - следующего соседа нет (ещё не пришёл или дальше двух часов) — подтвердить нечем: замер, резко
 *   подскочивший от предыдущего (или от обычного уровня), не показываем, пока следующий замер его
 *   не подтвердит (владелец 26.09: ночью 5.0 → 6.7 последней точкой попало на график — прежнее
 *   сравнение с обычным уровнем 6.0 давало всего 0.7 при скачке 0.9). Плавный подъём (6.0 → 6.5 → 7.0)
 *   виден сразу: от предыдущего он меньше скачка;
 * - выброс не попадает ни на график, ни в расчёты («Организм», «Цикл питания», колба).
 * Падения не фильтруем: ложных падений у кольца не встречалось.
 *
 * Первая версия считала «высоким» только замер выше уровня × 1.25 (у владельца ≈ 7.5) и пропускала
 * скачки 6.6 и 6.9 на его графике 25.09. Сравнение с соседями ловит их, а пик после еды
 * (7.3 → 6.7 → 6.6) оставляет: следующий замер «примерно такой же».
 */

/** Обычный уровень — медиана своих замеров за столько дней до дня замера (и сам день). */
export const GLUCOSE_LEVEL_DAYS = 7;
/**
 * Меньше замеров — своего уровня ещё нет, берём GLUCOSE_DEFAULT_LEVEL. Шесть — три часа замеров:
 * медиану шести один выброс уже не сдвигает, а в первый день кольца свой уровень появляется быстро.
 */
export const GLUCOSE_LEVEL_MIN_READINGS = 6;
/** Обычный уровень по умолчанию — ориентир владельца, 6 ммоль/л. */
export const GLUCOSE_DEFAULT_LEVEL = 6;
/** Скачок — доля обычного уровня: при уровне 6.0 это 0.9 ммоль/л. У каждого свой. */
export const GLUCOSE_JUMP_SHARE = 0.15;
/**
 * Сосед считается соседом, только если он не дальше этого. Кольцо мерит раз в 30 минут, но пока
 * человек идёт, замеры пропадают: 7.5 в 11:30 и 7.4 в 13:15 — один подъём, а не выброс.
 */
export const GLUCOSE_NEIGHBOR_GAP_MIN = 120;

const DAY_S = 86400;
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

/** Обычный уровень глюкозы: медиана замеров; мало замеров — уровень по умолчанию. */
export function glucoseLevel(values: readonly number[]): number {
  return values.length >= GLUCOSE_LEVEL_MIN_READINGS ? (median(values) as number) : GLUCOSE_DEFAULT_LEVEL;
}

/** Насколько замер должен быть выше обоих соседей, чтобы считаться выбросом. */
export const glucoseJump = (level: number) => level * GLUCOSE_JUMP_SHARE;

/**
 * Записи 0x55 без выбросов глюкозы: у выброса поле `glucose` становится null, остальные поля
 * (давление, стресс, вариабельность) остаются — это тот же замер. Метки — кольцевые секунды.
 */
export function dropGlucoseSpikes<T extends { ts: number; glucose: number | null }>(records: readonly T[]): T[] {
  const readings = records
    .filter((r) => r.glucose !== null)
    .map((r) => ({ ts: r.ts, v: r.glucose as number }))
    .sort((a, b) => a.ts - b.ts);
  if (!readings.length) return [...records];

  // Обычный уровень — по дням: медиана за семь дней до дня замера и сам день.
  const levels = new Map<string, number>();
  const levelOf = (ts: number) => {
    const date = dateKey(ts);
    let level = levels.get(date);
    if (level === undefined) {
      const to = midnight(date) + DAY_S;
      const from = to - (GLUCOSE_LEVEL_DAYS + 1) * DAY_S;
      level = glucoseLevel(readings.filter((r) => r.ts >= from && r.ts < to).map((r) => r.v));
      levels.set(date, level);
    }
    return level;
  };

  const spikes = new Set<number>();
  readings.forEach((r, i) => {
    const level = levelOf(r.ts);
    if (r.v <= level) return;
    const near = (n: { ts: number; v: number } | undefined) =>
      n !== undefined && Math.abs(n.ts - r.ts) <= GLUCOSE_NEIGHBOR_GAP_MIN * 60 ? n.v : null;
    // Предыдущего нет или он дальше двух часов — сравниваем с обычным уровнем.
    const before = near(readings[i - 1]) ?? level;
    const after = near(readings[i + 1]);
    // Следующего нет — подтвердить нечем: резкий скачок от предыдущего ждёт следующего замера.
    const around = after === null ? before : Math.max(before, after);
    if (r.v - around >= glucoseJump(level)) spikes.add(r.ts);
  });
  if (!spikes.size) return [...records];
  return records.map((r) => (r.glucose !== null && spikes.has(r.ts) ? { ...r, glucose: null } : r));
}

/**
 * Подъём глюкозы не от еды (решение владельца 26.09): «Цикл питания» (колба) и время еды для
 * «Мнения Лиса» ищут приёмы пищи по подъёмам глюкозы, но глюкоза поднимается и без еды:
 * - во сне — часто перед пробуждением: человек спит и не ест. Кроме первых двух часов сна:
 *   поел и сразу уснул — подъём от еды, колба честно покажет «Переработку»;
 * - на интенсивной нагрузке — вместе с пульсом.
 * Такой подъём не сбрасывает отсчёт колбы и не считается приёмом пищи. Замер остаётся на графике
 * и в остальных расчётах: это не выброс кольца, а настоящий уровень.
 *
 * Интенсивная нагрузка — пульс не ниже третьей пульсовой зоны: с неё эпизод нагрузки считается
 * тренировкой (training.ts, `SESSION_MIN_ZONE`). Время подъёма сравнивается со временем нагрузки:
 * замер между началом эпизода (с запасом на пару замеров одного автозамера) и концом эпизода
 * плюс один период автозамера — глюкоза от нагрузки не падает мгновенно.
 */
export type NotMealReason = 'sleep' | 'exercise';

/**
 * Пульс и глюкоза одного автозамера приходят не в одну минуту: пару ищем в ±15 минут, как
 * кислород к записи 0x55 в «Организме» (`OXYGEN_MATCH_MIN`).
 */
export const GLUCOSE_EXERCISE_BEFORE_MIN = 15;
/** После конца нагрузки подъём ещё относим к ней — один период автозамера кольца (30 минут). */
export const GLUCOSE_EXERCISE_AFTER_MIN = 30;

export interface Span {
  from: number;
  to: number;
}

/**
 * Интенсивная нагрузка: эпизоды нагрузки (`loadIntervals`) с пульсом от третьей зоны и одиночные
 * замеры пульса в этой зоне (силовая без шагов может попасть всего в один замер). Минуты — на той
 * же оси, что пульс и шаги. Возраст неизвестен — зон нет, нагрузку не ищем.
 */
export function intenseSpans(
  heart: readonly { m: number; v: number }[],
  steps: readonly { m: number; v: number }[],
  age: number | null,
  restingHr: number | null,
): Span[] {
  if (age === null) return [];
  const pulse = pulseAtShare(HR_ZONE_BOUNDS[SESSION_MIN_ZONE - 1], age, restingHr);
  const episodes = loadIntervals([...heart], age, [...steps], restingHr)
    .filter((e) => e.peak !== null && e.peak >= pulse)
    .map((e) => ({ from: e.from, to: e.to }));
  const hot = heart.filter((p) => p.v >= pulse).map((p) => ({ from: p.m, to: p.m }));
  return [...episodes, ...hot];
}

/**
 * Поел и сразу уснул — первые часы сна глюкоза ещё от еды: подъём в начале сна считаем едой.
 * Два часа — столько подъём после еды держится, прежде чем пойти вниз (как у соседей выброса,
 * `GLUCOSE_NEIGHBOR_GAP_MIN`). Позже во сне человек не ест: подъём (часто перед пробуждением) — не еда.
 */
export const GLUCOSE_SLEEP_DIGEST_MIN = GLUCOSE_NEIGHBOR_GAP_MIN;

/**
 * Сессии сна из отрезков гипнограммы: отрезки с разрывом до двух часов — одна ночь, как в `buildSleepSessions`.
 * Начало сессии — момент засыпания: от него считается `GLUCOSE_SLEEP_DIGEST_MIN`.
 */
export function sleepSpans(segments: readonly Span[]): Span[] {
  const sorted = [...segments].sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from - last.to <= SLEEP_SESSION_GAP / 60) last.to = Math.max(last.to, s.to);
    else out.push({ from: s.from, to: s.to });
  }
  return out;
}

/** Где подъём глюкозы — не еда: сессии сна (`sleepSpans`) и отрезки интенсивной нагрузки на одной оси минут. */
export interface NotMealContext {
  sleep: readonly Span[];
  exercise: readonly Span[];
}

/** Почему высокий замер в минуту `m` не еда; null — мог быть едой. */
export function notMealAt(m: number, ctx: NotMealContext): NotMealReason | null {
  if (ctx.sleep.some((s) => m > s.from + GLUCOSE_SLEEP_DIGEST_MIN && m <= s.to)) return 'sleep';
  if (ctx.exercise.some((e) => m >= e.from - GLUCOSE_EXERCISE_BEFORE_MIN && m <= e.to + GLUCOSE_EXERCISE_AFTER_MIN)) {
    return 'exercise';
  }
  return null;
}

/**
 * Помечает высокие замеры, которые не еда. `high` — что считать высоким (у колбы — от личного
 * среднего G_mid, у времени еды — от порога подъёма). Подъём, начавшийся во сне или на нагрузке,
 * остаётся «не едой», пока глюкоза держится высокой (соседние замеры не дальше
 * GLUCOSE_NEIGHBOR_GAP_MIN): проснулся в 6:30, а глюкоза ещё не опустилась — это не завтрак.
 * Подскочила по ходу ещё на скачок (`glucoseJump`) — это уже еда поверх подъёма.
 */
export function markNotMeal<T extends { m: number; v: number }>(
  points: readonly T[],
  ctx: NotMealContext,
  high: (v: number) => boolean,
  level: number,
): (T & { notMeal: NotMealReason | null })[] {
  const sorted = [...points].sort((a, b) => a.m - b.m);
  let carried: NotMealReason | null = null;
  return sorted.map((p, i) => {
    const prev = sorted[i - 1];
    if (!high(p.v)) {
      carried = null;
      return { ...p, notMeal: null };
    }
    const own = notMealAt(p.m, ctx);
    const continues =
      carried !== null && prev !== undefined && p.m - prev.m <= GLUCOSE_NEIGHBOR_GAP_MIN && p.v - prev.v < glucoseJump(level);
    const notMeal = own ?? (continues ? carried : null);
    carried = notMeal;
    return { ...p, notMeal };
  });
}
