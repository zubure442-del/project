import { describe, expect, it } from 'vitest';
import {
  GLUCOSE_DEFAULT_LEVEL,
  dropGlucoseSpikes,
  glucoseHighThreshold,
  glucoseLevel,
} from './glucose';

/** Кольцевая метка: 2026-09-21 + минуты от полуночи. */
const DAY = Date.parse('2026-09-21T00:00:00Z') / 1000;
const at = (m: number) => DAY + m * 60;
/** Ряд раз в 30 минут с 06:00: значения по порядку. */
const series = (values: number[], from = 360) =>
  values.map((v, i) => ({ ts: at(from + i * 30), glucose: v, systolic: 120 as number | null }));
const kept = (records: { glucose: number | null }[]) => records.map((r) => r.glucose);

/** Обычный уровень около 6.0 — как у владельца по логу 21.09: порог «высокого» 7.5. */
const CALM = [6, 5.8, 6.2, 6, 5.9, 6.1, 6, 6.2, 5.8, 6, 6.1, 5.9];

describe('СИНТЕТИЧЕСКИЕ: одиночный выброс глюкозы вверх', () => {
  it('порог свой: медиана своих замеров × 1.25; мало замеров — 6.0', () => {
    expect(glucoseLevel(CALM)).toBe(6);
    expect(glucoseHighThreshold(glucoseLevel(CALM))).toBe(7.5);
    expect(glucoseLevel([5, 5.2, 5.1, 5.3, 5])).toBe(GLUCOSE_DEFAULT_LEVEL);
    expect(glucoseHighThreshold(GLUCOSE_DEFAULT_LEVEL)).toBeCloseTo(6);
  });

  it('одиночный скачок, после которого сразу обычное значение, — выброс', () => {
    const out = dropGlucoseSpikes(series([...CALM, 12.4, 6, 5.9]));
    expect(kept(out)).toEqual([...CALM, null, 6, 5.9]);
    // Остальные поля того же замера остаются.
    expect(out[CALM.length].systolic).toBe(120);
  });

  it('пик после еды со спадом — настоящий (реальный лог 21.09: 7.8 → 7.3 → 6.2)', () => {
    const values = [...CALM, 7.8, 7.3, 6.2];
    expect(kept(dropGlucoseSpikes(series(values)))).toEqual(values);
  });

  it('спад после пика подтверждает предыдущий высокий замер', () => {
    const values = [...CALM, 6, 9, 8.6, 6.1];
    expect(kept(dropGlucoseSpikes(series(values)))).toEqual(values);
  });

  it('падения не трогаем', () => {
    const values = [...CALM, 3.1, 6];
    expect(kept(dropGlucoseSpikes(series(values)))).toEqual(values);
  });

  it('последний высокий замер ждёт следующего: до подтверждения его нет', () => {
    const pending = series([...CALM, 9.5]);
    expect(kept(dropGlucoseSpikes(pending)).at(-1)).toBeNull();
    // Пришёл следующий замер, тоже повышенный — оба засчитаны.
    expect(kept(dropGlucoseSpikes(series([...CALM, 9.5, 8.8]))).slice(-2)).toEqual([9.5, 8.8]);
  });

  it('сосед дальше часа не подтверждает', () => {
    const records = [...series(CALM), { ts: at(360 + 12 * 30), glucose: 9, systolic: 120 }, { ts: at(360 + 12 * 30 + 90), glucose: 8.9, systolic: 120 }];
    expect(kept(dropGlucoseSpikes(records)).slice(-2)).toEqual([null, null]);
  });

  it('у человека с высоким обычным уровнем его обычные значения — не выбросы', () => {
    const high = [7.4, 7.6, 7.2, 7.5, 7.3, 7.6, 7.4, 7.5, 7.7, 7.3, 7.4, 7.5, 8.2, 7.4];
    expect(kept(dropGlucoseSpikes(series(high)))).toEqual(high);
  });
});
