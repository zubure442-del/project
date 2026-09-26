import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hexToBytes } from '../codec';
import { emptySyncResult, resetLightThrottle, runSync } from '../ble/sync';
import type { Transport } from '../ble/transport';
import { EMPTY_STATE } from '../storage';
import {
  FINAL_AFTER_HOURS,
  applySyncResult,
  finalFrom,
  isFinalDay,
  markSynced,
  nightAfterArrived,
  planDays,
} from './sync-plan';

/** 21.09.2026 13:18 по местному времени — дневная сессия. */
const DAY = new Date(2026, 8, 21, 13, 18);
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);
const WEEK = [0, 1, 2, 3, 4, 5, 6];

describe('СИНТЕТИЧЕСКИЕ: какие дни запросить', () => {
  it('пустой кэш — вся неделя, с причиной для лога', () => {
    const plan = planDays({}, DAY);
    expect(plan.days).toEqual(WEEK);
    expect(plan.note).toContain('0 сегодня');
    expect(plan.note).toContain('6 15.09 нет в кэше');
  });

  it('в 13:00 после удачной синхронизации в 12:30 запрашивается только сегодня', () => {
    const synced = markSynced({}, WEEK, at(21, 12, 30));
    const plan = planDays(synced, at(21, 13));
    expect(plan.days).toEqual([0]);
    expect(plan.note).toContain('из кэша: 1, 2, 3, 4, 5, 6');
  });

  it('в 09:00 вчера запрашивается заново: до полудня он ещё не финальный', () => {
    const synced = markSynced({}, WEEK, at(21, 8, 30));
    const plan = planDays(synced, at(21, 9));
    expect(plan.days).toEqual([0, 1]);
    expect(plan.note).toContain('1 20.09 не финальный');
  });

  it('на следующее утро вчерашний день снова не финальный, а позавчерашний уже да', () => {
    const synced = markSynced({}, WEEK, at(21, 12, 30));
    expect(planDays(synced, at(22, 9)).days).toEqual([0, 1]);
    expect(isFinalDay('2026-09-20', synced)).toBe(true);
    expect(isFinalDay('2026-09-21', synced)).toBe(false);
  });

  it('дыра в середине не тянет за собой всю неделю', () => {
    const synced = markSynced({}, [0, 1, 2, 4, 5, 6], at(21, 12, 30));
    expect(planDays(synced, at(21, 13)).days).toEqual([0, 3]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: время выгрузки дней', () => {
  it('финальный — не раньше полудня следующего дня по местному времени', () => {
    expect(finalFrom('2026-09-20')).toBe(at(21, FINAL_AFTER_HOURS).getTime());
  });

  it('ночная сессия ничего не записывает: ночью кольцо не отдаёт сон', () => {
    expect(markSynced({ '2026-09-10': 1 }, [1, 2, 3], at(21, 1, 37))).toEqual({ '2026-09-10': 1 });
  });
});

describe('СИНТЕТИЧЕСКИЕ: вчера финальный, как только пришла ночь', () => {
  const day = (sleep: [number, number][]) => ({ date: '', steps: [], sleep, heart: [], summary: [], spo2: [] });

  it('сон после полуночи у сегодняшнего дня — ночь пришла', () => {
    expect(nightAfterArrived('2026-09-20', { '2026-09-21': day([[-60, 40], [30, 99]]) })).toBe(true);
  });

  it('только сон до полуночи (дневной сон вчера после полудня) — ночь ещё не пришла', () => {
    expect(nightAfterArrived('2026-09-20', { '2026-09-21': day([[-600, 40]]) })).toBe(false);
    expect(nightAfterArrived('2026-09-20', {})).toBe(false);
  });

  it('в 09:00 после ночи вчера сразу финальный, сегодня — нет', () => {
    const synced = markSynced({}, [0, 1], at(21, 9), (date) => date === '2026-09-20');
    expect(isFinalDay('2026-09-20', synced)).toBe(true);
    expect(isFinalDay('2026-09-21', synced)).toBe(false);
    expect(planDays(synced, at(21, 9, 30)).days).toEqual([0, 2, 3, 4, 5, 6]);
  });

  it('без ночи вчера до полудня по-прежнему запрашивается', () => {
    const synced = markSynced({}, [0, 1], at(21, 9));
    expect(isFinalDay('2026-09-20', synced)).toBe(false);
  });
});

describe('СИНТЕТИЧЕСКИЕ: обрыв связи', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLightThrottle();
  });
  afterEach(() => vi.useRealTimers());

  /** Кольцо отдаёт шаги за сегодня без маркера, а на третьей команде связь рвётся. */
  function breakingRing(): Transport {
    const listeners = new Set<(d: Uint8Array) => void>();
    let sent = 0;
    return {
      async send(data) {
        sent++;
        if (sent > 3) throw new Error('Кольцо отключилось. Нажмите «Обновить» ещё раз.');
        if (data[0] === 0x10) {
          const hex = '10 00 7c b0 6a 05 06 07 00 00 00 00 00 00 00 00 00 00 00 00'; // 21.09 00:36
          setTimeout(() => listeners.forEach((l) => l(hexToBytes(hex))), 30);
        }
      },
      onPacket(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
  }

  it('поток без маркера кончается паузой, и день не считается завершённым', async () => {
    const run = runSync(breakingRing(), { days: [0, 1] });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.completeDays).toEqual([]);
    expect(result.error).toContain('отключилось');
  });

  it('частичные данные сохраняются, но «Обновлено» не ставится и висит плашка', () => {
    const before = { ...EMPTY_STATE, started: true, lastSyncAt: 1000 };
    const partial = { ...emptySyncResult(), steps: [{ ts: 1790208000, value: 50 }], error: 'обрыв' };
    const next = applySyncResult(before, partial, null, DAY);
    expect(next.syncFailed).toBe(true);
    expect(next.lastSyncAt).toBe(1000);
    expect(Object.keys(next.raw).length).toBe(1);
  });
});

describe('СИНТЕТИЧЕСКИЕ: выброс глюкозы не доходит до графика', () => {
  it('одиночный скачок вверх убран из сводки дня, соседние замеры и давление того же замера на месте', () => {
    const base = Date.parse('2026-09-21T06:00:00Z') / 1000;
    const values = [6, 5.8, 6.2, 6, 5.9, 6.1, 6, 6.2, 13.5, 6, 5.9];
    const sync = {
      ...emptySyncResult(),
      summary: values.map((glucose, i) => ({ ts: base + i * 1800, systolic: 118, diastolic: 76, stress: 20, glucose, hrv: 50 })),
    };
    const state = applySyncResult(EMPTY_STATE, sync, null, DAY);
    const day = state.days.find((d) => d.date === '2026-09-21')!;
    const spike = day.summaryPoints.find((p) => p.m === 6 * 60 + 8 * 30)!;
    expect(spike.glucose).toBeNull();
    expect(spike.systolic).toBe(118);
    expect(day.summaryPoints.filter((p) => p.glucose !== null)).toHaveLength(values.length - 1);
    // Сырые ряды не тронуты: подтверждение может прийти со следующим замером.
    expect(state.raw['2026-09-21'].summary.some((r) => r[4] === 135)).toBe(true);
  });
});
