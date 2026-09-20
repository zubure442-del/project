import { describe, expect, it } from 'vitest';
import { buildDemoSync } from '../domain';
import { buildSnapshots, mergeSnapshots } from './build';
import { addReport, recentTemplateIds } from './store';
import type { DaySnapshot, StoredReport } from './types';

const NOW = new Date('2026-09-19T19:30:00');
const demo = () => buildSnapshots(buildDemoSync({ now: NOW }), 30);

describe('сводки по дням', () => {
  it('демо-неделя даёт 7 дней подряд с итогом', () => {
    const days = demo();
    expect(days.length).toBeGreaterThanOrEqual(7);
    const week = days.slice(-7);
    expect(week.every((d) => d.total !== null)).toBe(true);
    expect(week.map((d) => d.date)).toEqual([...week.map((d) => d.date)].sort());
  });
  it('день-пропуск показывает «нет данных» по сну и состоянию, но не нулём', () => {
    const gap = demo().find((d) => d.sleep === null);
    expect(gap).toBeDefined();
    expect(gap?.scores.sleep).toBeNull();
    expect(gap?.scores.state).toBeNull();
    expect(gap?.scores.activity).not.toBeNull();
    expect(gap?.total).not.toBeNull();
  });
  it('точки графика — минуты от полуночи в пределах суток', () => {
    for (const d of demo()) {
      for (const p of [...d.heart, ...d.spo2]) {
        expect(p.m).toBeGreaterThanOrEqual(0);
        expect(p.m).toBeLessThan(1440);
      }
    }
  });
  it('сегодняшний день обрывается на текущем времени', () => {
    const today = demo().at(-1);
    expect(Math.max(...today!.heart.map((p) => p.m))).toBeLessThanOrEqual(19 * 60 + 30);
  });
  it('давление и глюкоза попадают в «оценки», а не в баллы', () => {
    const day = demo().at(-1)!;
    expect(day.estimates.glucose).toBeGreaterThan(4);
    expect(day.estimates.systolic).toBeGreaterThan(100);
    expect(Object.keys(day.scores)).toEqual(['sleep', 'activity', 'state']);
  });
  it('гипнограмма покрывает ночь, шаги разложены по часам', () => {
    const day = demo().find((d) => d.sleep !== null)!;
    expect(day.sleepSegments.length).toBeGreaterThan(3);
    expect(day.sleepSegments[0].from).toBeLessThan(0); // сон начался накануне вечером
    expect(day.sleepSegments.every((s) => s.to > s.from)).toBe(true);
    expect(day.stepsByHour).toHaveLength(24);
    expect(day.stepsByHour.reduce((a, b) => a + b, 0)).toBe(day.steps);
  });
  it('напряжение сохраняется точками, а не только средним', () => {
    const day = demo().at(-1)!;
    expect(day.stress.length).toBeGreaterThan(3);
    expect(day.estimates.stress).not.toBeNull();
  });

  it('пустая выгрузка не даёт ни одного дня', () => {
    expect(buildSnapshots(
      { steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
        packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 } }, 30,
    )).toEqual([]);
  });
});

describe('история', () => {
  const day = (date: string, total: number): DaySnapshot => ({
    date, total, scores: { sleep: null, activity: total, state: null }, steps: 100, sleep: null,
    restingHr: null, heart: [], spo2: [], stress: [], stepsByHour: new Array(24).fill(0), sleepSegments: [],
    estimates: { hrv: null, glucose: null, systolic: null, diastolic: null, stress: null },
  });

  it('хранится ровно 7 последних дней', () => {
    const many = Array.from({ length: 12 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, i));
    const merged = mergeSnapshots([], many);
    expect(merged).toHaveLength(7);
    expect(merged[0].date).toBe('2026-09-06');
  });
  it('новая выгрузка обновляет день, а не дублирует его', () => {
    const merged = mergeSnapshots([day('2026-09-18', 40)], [day('2026-09-18', 77)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].total).toBe(77);
  });
});

describe('выданные советы', () => {
  const r = (date: string, mode: 'morning' | 'evening', id: string): StoredReport =>
    ({ date, mode, templateId: id, text: id });

  it('утренний и вечерний советы за один день живут рядом', () => {
    const list = addReport(addReport([], r('2026-09-19', 'morning', 'a')), r('2026-09-19', 'evening', 'b'));
    expect(recentTemplateIds(list)).toEqual(['a', 'b']);
  });
  it('повторная выдача за тот же день и время заменяет прежнюю', () => {
    const list = addReport(addReport([], r('2026-09-19', 'morning', 'a')), r('2026-09-19', 'morning', 'c'));
    expect(recentTemplateIds(list)).toEqual(['c']);
  });
});
