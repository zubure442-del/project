import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hexToBytes } from '../codec';
import { emptySyncResult, resetLightThrottle, runSync } from '../ble/sync';
import type { Transport } from '../ble/transport';
import { EMPTY_STATE } from '../storage';
import { applySyncResult, markComplete, planDays } from './sync-plan';

/** 21.09.2026 13:18 по местному времени — дневная сессия. */
const DAY = new Date(2026, 8, 21, 13, 18);
const ALL_PAST = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];

describe('СИНТЕТИЧЕСКИЕ: какие дни запросить', () => {
  it('пустой кэш — вся неделя, с причиной для лога', () => {
    const plan = planDays([], DAY);
    expect(plan.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(plan.note).toContain('0 сегодня');
    expect(plan.note).toContain('1 вчера');
    expect(plan.note).toContain('6 15.09 нет в кэше');
  });

  it('дни 2–6 завершены — только сегодня и вчера', () => {
    const plan = planDays(ALL_PAST, DAY);
    expect(plan.days).toEqual([0, 1]);
    expect(plan.note).toContain('из кэша: 2, 3, 4, 5, 6');
  });

  it('сегодня и вчера запрашиваем всегда, даже если отмечены', () => {
    expect(planDays([...ALL_PAST, '2026-09-20', '2026-09-21'], DAY).days).toEqual([0, 1]);
  });

  it('дыра в середине не тянет за собой всю неделю', () => {
    const withoutDay4 = ALL_PAST.filter((d) => d !== '2026-09-17');
    expect(planDays(withoutDay4, DAY).days).toEqual([0, 1, 4]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: отметка завершённых дней', () => {
  it('сегодняшний день не отмечаем: он ещё идёт', () => {
    expect(markComplete([], [0, 1, 2], DAY)).toEqual(['2026-09-19', '2026-09-20']);
  });

  it('ночная сессия ничего не отмечает: ночью кольцо не отдаёт сон', () => {
    expect(markComplete(['2026-09-10'], [1, 2, 3], new Date(2026, 8, 21, 1, 37))).toEqual(['2026-09-10']);
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
