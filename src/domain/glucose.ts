import { dateKey } from '../codec';
import { median } from './food';

/**
 * Защита от случайных выбросов глюкозы ВВЕРХ (решение владельца 26.09).
 *
 * Кольцо иногда выдаёт одиночное высокое значение, которого не было. Настоящий подъём (после еды)
 * так не выглядит: глюкоза растёт 30–60 минут и возвращается к обычной за два-три часа, поэтому
 * через полчаса после пика она ещё заметно повышена. Правило:
 * - «высокий» замер — выше своего порога: обычный уровень человека × (1 + GLUCOSE_HIGH_SHARE);
 * - высокий замер засчитываем, только если соседний замер (следующий или предыдущий, не дальше
 *   GLUCOSE_CONFIRM_GAP_MIN) сохранил хотя бы половину подъёма над обычным уровнем.
 *   Предыдущий нужен для спада после пика: 7.8 → 7.3 → 6.2 — пик и спад настоящие;
 * - одиночный высокий замер — выброс: на график и в расчёты («Организм», «Цикл питания», колба)
 *   он не попадает. Последний высокий замер без подтверждения ждёт следующего — до него его нет.
 * Падения не фильтруем: ложных падений у кольца не встречалось.
 *
 * Почему сосед не обязан быть выше того же порога: по реальному логу 21.09 у кольца после еды
 * обычно одна высокая точка, а следующая чуть ниже (7.8 → 7.3). С одинаковым порогом
 * выброшенными оказались бы почти все настоящие пики после еды.
 */

/** Обычный уровень — медиана своих замеров за столько дней до дня замера (и сам день). */
export const GLUCOSE_LEVEL_DAYS = 7;
/**
 * Меньше замеров — своего уровня ещё нет, берём GLUCOSE_DEFAULT_LEVEL. Шесть — три часа замеров:
 * медиану шести один выброс уже не сдвигает, а в первый день кольца свой уровень появляется быстро.
 */
export const GLUCOSE_LEVEL_MIN_READINGS = 6;
/** Обычный уровень по умолчанию: порог тогда 6.0 ммоль/л. */
export const GLUCOSE_DEFAULT_LEVEL = 4.8;
/** Порог «высокого» — на столько выше обычного уровня (как верх коридора нормы «Цикла питания»). */
export const GLUCOSE_HIGH_SHARE = 0.25;
/** Сосед подтверждает, только если он не дальше этого (кольцо мерит раз в 30 минут). */
export const GLUCOSE_CONFIRM_GAP_MIN = 60;
/** Какую долю подъёма над обычным уровнем сосед должен сохранить. */
export const GLUCOSE_CONFIRM_KEEP = 0.5;

const DAY_S = 86400;
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

/** Обычный уровень глюкозы: медиана замеров; мало замеров — уровень по умолчанию. */
export function glucoseLevel(values: readonly number[]): number {
  return values.length >= GLUCOSE_LEVEL_MIN_READINGS ? (median(values) as number) : GLUCOSE_DEFAULT_LEVEL;
}

/** Порог «высокого» замера для обычного уровня. */
export const glucoseHighThreshold = (level: number) => level * (1 + GLUCOSE_HIGH_SHARE);

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
    if (r.v <= glucoseHighThreshold(level)) return;
    const bar = level + (r.v - level) * GLUCOSE_CONFIRM_KEEP;
    const confirms = (n: { ts: number; v: number } | undefined) =>
      n !== undefined && Math.abs(n.ts - r.ts) <= GLUCOSE_CONFIRM_GAP_MIN * 60 && n.v >= bar;
    if (!confirms(readings[i - 1]) && !confirms(readings[i + 1])) spikes.add(r.ts);
  });
  if (!spikes.size) return [...records];
  return records.map((r) => (r.glucose !== null && spikes.has(r.ts) ? { ...r, glucose: null } : r));
}
