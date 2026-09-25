import { describe, expect, it } from 'vitest';
import { GLUCOSE_DEFAULT_LEVEL, dropGlucoseSpikes, glucoseJump, glucoseLevel } from './glucose';

/** Кольцевая метка: 2026-09-21 + минуты от полуночи. */
const DAY = Date.parse('2026-09-21T00:00:00Z') / 1000;
const at = (m: number) => DAY + m * 60;
/** Ряд раз в 30 минут с 06:00: значения по порядку. */
const series = (values: number[], from = 360) =>
  values.map((v, i) => ({ ts: at(from + i * 30), glucose: v, systolic: 120 as number | null }));
const kept = (records: { glucose: number | null }[]) => records.map((r) => r.glucose);

/** Обычный уровень 6.0 — как у владельца: скачок 0.9 ммоль/л. */
const CALM = [6, 5.8, 6.2, 6, 5.9, 6.1, 6, 6.2, 5.8, 6, 6.1, 5.9];

describe('СИНТЕТИЧЕСКИЕ: одиночный выброс глюкозы вверх', () => {
  it('уровень свой: медиана своих замеров; мало замеров — ориентир 6; скачок — 15 % уровня', () => {
    expect(glucoseLevel(CALM)).toBe(6);
    expect(glucoseJump(6)).toBeCloseTo(0.9);
    expect(glucoseLevel([5, 5.2, 5.1, 5.3, 5])).toBe(GLUCOSE_DEFAULT_LEVEL);
    expect(glucoseJump(4.8)).toBeCloseTo(0.72);
  });

  it('точка выше обоих соседей больше чем на скачок — выброс; другие поля замера остаются', () => {
    const out = dropGlucoseSpikes(series([...CALM, 12.4, 6, 5.9]));
    expect(kept(out)).toEqual([...CALM, null, 6, 5.9]);
    expect(out[CALM.length].systolic).toBe(120);
  });

  it('график владельца 25.09 вечером (по скриншоту): 5.4 → 6.6 → 5.4 — выброс, ужин 5.7 → 7.3 → 6.7 → 6.6 — нет', () => {
    const evening = [
      [900, 5.8], [930, 5.8], [960, 5.4], [1020, 6.6], [1050, 5.4], [1080, 5.7], [1140, 7.3], [1200, 6.7], [1230, 6.6], [1260, 6.3],
    ].map(([m, v]) => ({ ts: at(m), glucose: v }));
    const out = kept(dropGlucoseSpikes([...series(CALM, 0), ...evening]));
    expect(out.slice(CALM.length)).toEqual([5.8, 5.8, 5.4, null, 5.4, 5.7, 7.3, 6.7, 6.6, 6.3]);
  });

  it('пик после еды со спадом — настоящий (реальный лог 21.09: 7.8 → 7.3 → 6.2)', () => {
    const values = [...CALM, 7.8, 7.3, 6.2];
    expect(kept(dropGlucoseSpikes(series(values)))).toEqual(values);
  });

  it('подъём из двух точек и спад — настоящий', () => {
    const values = [...CALM, 6, 9, 8.6, 6.1];
    expect(kept(dropGlucoseSpikes(series(values)))).toEqual(values);
  });

  it('падения не трогаем', () => {
    const values = [...CALM, 3.1, 6];
    expect(kept(dropGlucoseSpikes(series(values)))).toEqual(values);
  });

  it('последний высокий замер ждёт следующего: до подтверждения его нет', () => {
    expect(kept(dropGlucoseSpikes(series([...CALM, 9.5]))).at(-1)).toBeNull();
    // Пришёл следующий замер, тоже повышенный — оба засчитаны.
    expect(kept(dropGlucoseSpikes(series([...CALM, 9.5, 8.8]))).slice(-2)).toEqual([9.5, 8.8]);
  });

  it('сосед дальше двух часов не сосед: вместо него обычный уровень', () => {
    const last = 360 + 11 * 30;
    const far = [...series(CALM), { ts: at(last + 150), glucose: 9, systolic: 120 }, { ts: at(last + 300), glucose: 8.9, systolic: 120 }];
    expect(kept(dropGlucoseSpikes(far)).slice(-2)).toEqual([null, null]);
    // Пропуск меньше двух часов (замеры пропали на ходу) — подъём настоящий.
    const walk = [...series(CALM), { ts: at(last + 45), glucose: 7.5, systolic: 120 }, { ts: at(last + 150), glucose: 7.4, systolic: 120 }];
    expect(kept(dropGlucoseSpikes(walk)).slice(-2)).toEqual([7.5, 7.4]);
  });

  it('у человека с высоким обычным уровнем его обычные колебания — не выбросы', () => {
    const high = [7.4, 7.6, 7.2, 7.5, 7.3, 7.6, 7.4, 7.5, 7.7, 7.3, 7.4, 7.5, 8.2, 7.4];
    expect(kept(dropGlucoseSpikes(series(high)))).toEqual(high);
  });
});
