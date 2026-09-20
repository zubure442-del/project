import { describe, expect, it } from 'vitest';
import type { SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import { buildSnapshots } from './build';
import { mergeRaw, splitByDay, toSyncResult } from './raw';

const ring = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') / 1000;

const empty: SyncResult = {
  steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
  packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
};

const summary: SummaryRecord[] = [
  { ts: ring('2026-09-20 03:00:00'), systolic: 113, diastolic: 72, stress: 20, glucose: 5.3, hrv: 82 },
  { ts: ring('2026-09-20 03:30:00'), systolic: 115, diastolic: 74, stress: 24, glucose: 5.1, hrv: 78 },
];
const heart = [30, 60, 90].map((m) => ({ ts: ring('2026-09-20 00:00:00') + m * 60, value: 60 + m / 30, raw: [60] }));
const night = Array.from({ length: 120 }, (_, i) => ({ ts: ring('2026-09-19 23:30:00') + i * 60, value: 40 }));

describe('кэш рядов', () => {
  it('ночь через полночь целиком попадает в день пробуждения', () => {
    const raw = splitByDay({ ...empty, sleep: night });
    expect(Object.keys(raw)).toEqual(['2026-09-20']);
    // вечерние минуты отрицательные, утренние — обычные
    expect(Math.min(...raw['2026-09-20'].sleep.map(([m]) => m))).toBeLessThan(0);
  });

  it('туда и обратно: ряды переживают сохранение', () => {
    const raw = splitByDay({ ...empty, summary, heart });
    const back = toSyncResult(raw);
    expect(back.summary.map((r) => [r.systolic, r.hrv, r.glucose])).toEqual([
      [113, 82, 5.3],
      [115, 78, 5.1],
    ]);
    expect(back.heart.map((h) => h.value)).toEqual([61, 62, 63]);
  });

  it('частичная синхронизация не стирает ряды', () => {
    const full = splitByDay({ ...empty, summary, heart });
    // пришли только шаги: сводка и пульс за этот день должны остаться
    const partial = splitByDay({
      ...empty,
      steps: [{ ts: ring('2026-09-20 08:00:00'), value: 12 }],
    });
    const merged = mergeRaw(full, partial);

    expect(merged['2026-09-20'].summary).toHaveLength(2);
    expect(merged['2026-09-20'].heart).toHaveLength(3);
    expect(merged['2026-09-20'].steps).toHaveLength(1);

    const day = buildSnapshots(toSyncResult(merged), 30).find((d) => d.date === '2026-09-20');
    expect(day?.summaryPoints).toHaveLength(2);
    expect(day?.estimates.hrv).toBe(80);
    expect(day?.heart).toHaveLength(3);
  });

  it('новые данные того же типа заменяют старые', () => {
    const before = splitByDay({ ...empty, summary });
    const after = splitByDay({
      ...empty,
      summary: [{ ts: ring('2026-09-20 04:00:00'), systolic: 120, diastolic: 80, stress: 30, glucose: 5, hrv: 70 }],
    });
    expect(mergeRaw(before, after)['2026-09-20'].summary).toHaveLength(1);
  });

  it('хранятся последние семь дней', () => {
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => {
        const date = `2026-09-${String(i + 10).padStart(2, '0')}`;
        return [date, { date, steps: [[1, 1] as [number, number]], sleep: [], heart: [], summary: [] }];
      }),
    );
    const kept = Object.keys(mergeRaw({}, many));
    expect(kept).toHaveLength(7);
    expect(kept[0]).toBe('2026-09-13');
  });
});
