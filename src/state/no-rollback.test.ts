import { describe, expect, it } from 'vitest';
import { emptySyncResult, type SyncResult } from '../ble/sync';
import { generateDemoRaw } from '../demo/generate';
import { EMPTY_STATE, mergeRaw, splitByDay, toSyncResult, type Profile, type VueloState } from '../storage';
import { findDay } from './day';
import { applySyncResult, rebuildDays } from './sync-plan';

/**
 * СИНТЕТИЧЕСКИЕ: повторный вход не откатывает посчитанный день в «Считаем вашу активность».
 * Полный день — ряды демо-генератора того же вида, что после выгрузки кольца.
 */
const TODAY = '2026-09-22';
const FIRST = new Date(2026, 8, 22, 13, 10);
const AGAIN = new Date(2026, 8, 22, 15, 40);
const PROFILE: Profile = { name: null, sex: 'female', heightCm: 168, weightKg: 60, birthYear: 1994, goal: 'keep' };
const midnight = Date.parse(`${TODAY}T00:00:00Z`) / 1000;
const ofToday = (ts: number) => ts >= midnight && ts < midnight + 86400;

/** Зерно, у которого сегодняшняя ночь начинается до полуночи: так проверяется и вечерняя часть сна. */
function fullWeek(): SyncResult {
  for (let seed = 1; seed < 200; seed++) {
    const raw = generateDemoRaw(seed, FIRST);
    if (raw[TODAY]?.sleep.some(([m]) => m < 0)) return toSyncResult(raw);
  }
  throw new Error('нет зерна с ночью через полночь');
}

describe('СИНТЕТИЧЕСКИЕ: повторный вход не откатывает метрики', () => {
  const full = fullWeek();
  const base: VueloState = { ...EMPTY_STATE, started: true, profile: PROFILE };
  const first = applySyncResult(base, { ...full, completeDays: [0, 1, 2, 3, 4, 5, 6] }, null, FIRST);
  const day = findDay(first.days, TODAY);

  it('исходно день полный: есть сон, активность, организм и итог', () => {
    expect(day?.total).not.toBeNull();
    expect(day?.scores.sleep).not.toBeNull();
    expect(day?.scores.state).not.toBeNull();
    expect(day?.calories).not.toBeNull();
  });

  it('кольцо ничего не прислало — день тот же, итог на месте', () => {
    const again = applySyncResult(first, emptySyncResult(), null, AGAIN);
    const after = findDay(again.days, TODAY);
    expect(after?.total).not.toBeNull();
    expect(after?.scores.sleep).toBe(day?.scores.sleep);
    expect(after?.sleep).toEqual(day?.sleep);
  });

  it('ответ оборвался: часть замеров 0x55, ночь без вечера, без кислорода — итог и сон не теряются', () => {
    const cut: SyncResult = {
      ...emptySyncResult(),
      // поток 0x55 оборвался после трёх замеров (как в логе d, 21.09 19:53 — без маркера конца)
      summary: full.summary.filter((r) => ofToday(r.ts)).slice(0, 3),
      // в окне сегодняшнего дня приходит только часть ночи после полуночи
      sleep: full.sleep.filter((s) => ofToday(s.ts)),
      steps: full.steps.filter((s) => ofToday(s.ts)).slice(0, 10),
      heart: full.heart.filter((s) => ofToday(s.ts)).slice(-1),
      error: 'обрыв',
    };
    const again = applySyncResult(first, cut, null, AGAIN);
    const after = findDay(again.days, TODAY);
    expect(after?.total).not.toBeNull();
    expect(after?.scores.state).not.toBeNull();
    expect(after?.sleep).toEqual(day?.sleep);
    expect(after?.summaryPoints.length).toBe(day?.summaryPoints.length);
    expect(after?.steps).toBe(day?.steps);
  });

  it('после живого замера пульс дня не заменяется одной точкой, калории на месте', () => {
    const ts = midnight + (15 * 60 + 40) * 60;
    const raw = mergeRaw(first.raw, splitByDay({ ...emptySyncResult(), heart: [{ ts, value: 64, raw: [64] }] }));
    const next = rebuildDays({ ...first, raw }, AGAIN);
    const after = findDay(next.days, TODAY);
    expect(after?.heart.length).toBe((day?.heart.length ?? 0) + 1);
    expect(after?.calories).not.toBeNull();
    expect(after?.total).not.toBeNull();
  });

  it('сводка переживает перезапуск: сохранённые ряды дают тот же день', () => {
    const reloaded = JSON.parse(JSON.stringify(first)) as VueloState;
    const after = findDay(rebuildDays(reloaded, AGAIN).days, TODAY);
    expect(after?.total).not.toBeNull();
    expect(after?.sleep).toEqual(day?.sleep);
  });
});
