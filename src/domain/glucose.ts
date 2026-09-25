import { dateKey } from '../codec';
import { median } from './food';

/**
 * Защита от случайных выбросов глюкозы ВВЕРХ (решение владельца 26.09, вторая версия).
 *
 * Кольцо иногда выдаёт одиночное высокое значение, которого не было: 5.1 → 6.9 → 5.4 ночью.
 * Настоящий подъём (после еды) так не выглядит: глюкоза растёт 30–60 минут и возвращается
 * к обычной за два-три часа, поэтому соседний замер через полчаса «примерно такой же».
 * Правило:
 * - замер выше своего обычного уровня и выше ОБОИХ соседей (предыдущего и следующего, не дальше
 *   GLUCOSE_NEIGHBOR_GAP_MIN) больше чем на скачок — GLUCOSE_JUMP_SHARE от обычного уровня, — выброс;
 * - соседа нет (дальше двух часов или ещё не пришёл) — вместо него обычный уровень. Поэтому последний
 *   высокий замер ждёт следующего: пока его нет, точки нет;
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
    // Соседа нет или он дальше двух часов — сравниваем с обычным уровнем.
    const near = (n: { ts: number; v: number } | undefined) =>
      n !== undefined && Math.abs(n.ts - r.ts) <= GLUCOSE_NEIGHBOR_GAP_MIN * 60 ? n.v : level;
    const around = Math.max(near(readings[i - 1]), near(readings[i + 1]));
    if (r.v - around >= glucoseJump(level)) spikes.add(r.ts);
  });
  if (!spikes.size) return [...records];
  return records.map((r) => (r.glucose !== null && spikes.has(r.ts) ? { ...r, glucose: null } : r));
}
