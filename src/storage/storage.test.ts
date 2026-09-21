import { describe, expect, it } from 'vitest';
import type { Sample, SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import { buildSnapshots, keepLastDays } from './build';
import { addReport, recentTemplateIds } from './store';
import type { DaySnapshot, StoredReport } from './types';

const ring = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') / 1000;

/** Минуты одного значения подряд. */
const minutes = (from: string, count: number, value: number): Sample[] =>
  Array.from({ length: count }, (_, i) => ({ ts: ring(from) + i * 60, value }));

const empty: SyncResult = {
  steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
  packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 }, completeDays: [], error: null, capped: false,
};

/** Ночь 18→19 сентября: 5 часов лёгкого и час глубокого сна. */
const night = [...minutes('2026-09-18 23:00:00', 300, 40), ...minutes('2026-09-19 04:00:00', 60, 99)];

const day = (over: Partial<SyncResult> = {}): SyncResult => ({ ...empty, ...over });

describe('сводки по дням', () => {
  it('ночь попадает в день своего пробуждения', () => {
    const [snapshot] = buildSnapshots(day({ sleep: night }), 30);
    expect(snapshot.date).toBe('2026-09-19');
    expect(snapshot.sleep).toEqual({ totalMin: 360, deepMin: 60, lightMin: 300 });
    expect(snapshot.sleepSegments.length).toBeGreaterThan(1);
    // сон начался накануне вечером, значит минуты до полуночи отрицательные
    expect(Math.min(...snapshot.sleepSegments.map((s) => s.from))).toBeLessThan(0);
  });

  it('шаги раскладываются по часам и совпадают с суммой', () => {
    const steps = [...minutes('2026-09-19 08:00:00', 10, 12), ...minutes('2026-09-19 19:00:00', 5, 30)];
    const [snapshot] = buildSnapshots(day({ steps }), 30);
    expect(snapshot.steps).toBe(270);
    expect(snapshot.stepsByHour).toHaveLength(24);
    expect(snapshot.stepsByHour[8]).toBe(120);
    expect(snapshot.stepsByHour[19]).toBe(150);
    expect(snapshot.stepsByHour.reduce((a, b) => a + b, 0)).toBe(snapshot.steps);
  });

  it('без данных за день сводка не создаётся', () => {
    expect(buildSnapshots(empty, 30)).toEqual([]);
  });

  it('«Организм» v2: замеры 0x55 покрывают не меньше 4 часов — оценка есть, меньше — нет', () => {
    // Замеры раз в 30 минут с 08:00; у каждого есть вариабельность и давление — два показателя.
    const records = (count: number): SummaryRecord[] =>
      Array.from({ length: count }, (_, i) => ({
        ts: ring('2026-09-19 08:00:00') + i * 1800, systolic: 118, diastolic: 76, stress: 35, glucose: 5.1, hrv: 50,
      }));
    const past = new Date(2026, 8, 25, 12);
    const enough = buildSnapshots(day({ summary: records(8) }), 30, {}, null, past).find((d) => d.date === '2026-09-19');
    expect(enough?.stateInputs).toMatchObject({ hrv: true });
    expect(enough?.scores.state).not.toBeNull();
    const short = buildSnapshots(day({ summary: records(7) }), 30, {}, null, past).find((d) => d.date === '2026-09-19');
    expect(short?.scores.state).toBeNull();
  });

  it('давление и глюкоза видны как оценка в сводке', () => {
    const summary: SummaryRecord[] = [
      { ts: ring('2026-09-19 12:00:00'), systolic: 120, diastolic: 80, stress: 40, glucose: 5.4, hrv: null },
    ];
    const [snapshot] = buildSnapshots(day({ summary }), 30);
    expect(snapshot.estimates.glucose).toBe(5.4);
    expect(snapshot.estimates.systolic).toBe(120);
    expect(Object.keys(snapshot.scores)).toEqual(['sleep', 'activity', 'state']);
  });

  it('кислород снова попадает в сводку', () => {
    const [snapshot] = buildSnapshots(
      day({ spo2: [{ ts: ring('2026-09-19 10:00:00'), value: 97 }] }),
      30,
    );
    expect(snapshot.spo2).toEqual([{ m: 600, v: 97 }]);
  });
});

describe('кэш последней синхронизации', () => {
  const snapshot = (date: string, total: number): DaySnapshot => ({
    date, total, scores: { sleep: null, activity: total, state: null }, steps: 100, sleep: null,
    restingHr: null, restingHrSource: null, stateInputs: { hrv: false, restingHr: false, spo2: false },
    heart: [], spo2: [], stress: [], summaryPoints: [], stepsByHour: new Array(24).fill(0), stepsByMinute: [], sleepSegments: [],
    estimates: { hrv: null, glucose: null, systolic: null, diastolic: null, stress: null },
  });

  it('хранится не больше семи последних дней', () => {
    const many = Array.from({ length: 12 }, (_, i) => snapshot(`2026-09-${String(i + 1).padStart(2, '0')}`, i));
    const kept = keepLastDays(many);
    expect(kept).toHaveLength(7);
    expect(kept[0].date).toBe('2026-09-06');
  });

  it('дни идут по возрастанию даты', () => {
    const kept = keepLastDays([snapshot('2026-09-19', 1), snapshot('2026-09-17', 2)]);
    expect(kept.map((d) => d.date)).toEqual(['2026-09-17', '2026-09-19']);
  });
});

describe('выданные советы', () => {
  const r = (date: string, mode: 'morning' | 'day' | 'evening', id: string): StoredReport =>
    ({ date, mode, templateId: id, text: id });

  it('советы за разное время дня живут рядом', () => {
    const list = addReport(addReport([], r('2026-09-19', 'morning', 'a')), r('2026-09-19', 'evening', 'b'));
    expect(recentTemplateIds(list)).toEqual(['a', 'b']);
  });

  it('повторная выдача за то же время заменяет прежнюю', () => {
    const list = addReport(addReport([], r('2026-09-19', 'morning', 'a')), r('2026-09-19', 'morning', 'c'));
    expect(recentTemplateIds(list)).toEqual(['c']);
  });
});
