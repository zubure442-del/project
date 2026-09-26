import { describe, expect, it } from 'vitest';
import { CYCLE_MAX_HOURS, OFF_BODY_GAP_MIN, buildCycles, offBodyGaps } from './cycles';
import type { SleepSession } from './sleep';

/** Кольцевая метка 25.09.2026 + часы (можно больше 24 и меньше нуля). */
const at = (hours: number) => Date.parse('2026-09-25T00:00:00Z') / 1000 + Math.round(hours * 3600);
const session = (from: number, to: number, deepShare = 0.2): SleepSession => {
  const minutes = Math.round((to - from) * 60);
  const deep = Math.round(minutes * deepShare);
  return { start: at(from), end: at(to), deepMin: deep, lightMin: minutes - deep, awakeMin: 0, date: '' };
};
/** Замеры каждые 30 минут на отрезке часов. */
const every30 = (from: number, to: number) =>
  Array.from({ length: Math.floor((to - from) * 2) + 1 }, (_, i) => at(from + i / 2));

describe('СИНТЕТИЧЕСКИЕ: циклы бодрствования', () => {
  it('обычные сутки: цикл от подъёма до засыпания, текущий идёт через полночь', () => {
    const { cycles, ringOffSince } = buildCycles({
      sessions: [session(-1, 7), session(23.5, 31)],
      measurements: every30(-1, 26),
      dataStart: at(-1),
      horizon: at(26),
    });
    expect(ringOffSince).toBeNull();
    expect(cycles.map((c) => [c.startedBy, c.endedBy])).toEqual([
      ['wake', 'sleep'],
      ['wake', null],
    ]);
    expect(cycles[0].start).toBe(at(7));
    expect(cycles[0].end).toBe(at(23.5));
  });

  it('в 00:30 цикл вчерашнего дня ещё идёт: полночь его не рвёт', () => {
    const { cycles } = buildCycles({
      sessions: [session(-1, 7)],
      measurements: every30(-1, 24.5),
      dataStart: at(-1),
      horizon: at(24.5),
    });
    const current = cycles[cycles.length - 1];
    expect(current.end).toBeNull();
    expect(current.start).toBe(at(7));
    expect(current.sleep?.start).toBe(at(-1));
  });

  it('дрёма 20 минут цикл не рвёт, дневной сон дольше 30 минут — рвёт', () => {
    const short = buildCycles({
      sessions: [session(-1, 7), session(14, 14 + 20 / 60)],
      measurements: every30(-1, 20),
      dataStart: at(-1),
      horizon: at(20),
    });
    expect(short.cycles).toHaveLength(1);
    const nap = buildCycles({
      sessions: [session(-1, 7), session(14, 14.75)],
      measurements: every30(-1, 20),
      dataStart: at(-1),
      horizon: at(20),
    });
    expect(nap.cycles.map((c) => [c.start, c.end])).toEqual([
      [at(7), at(14)],
      [at(14.75), null],
    ]);
  });

  it('больше 28 часов без сна — цикл закрыт по таймауту, остаток — новый цикл без сна', () => {
    const { cycles } = buildCycles({
      sessions: [session(-1, 7)],
      measurements: every30(-1, 7 + 30),
      dataStart: at(-1),
      horizon: at(7 + 30),
    });
    expect(cycles.map((c) => [c.startedBy, c.endedBy])).toEqual([
      ['wake', 'timeout'],
      ['timeout', null],
    ]);
    expect(cycles[0].end! - cycles[0].start).toBe(CYCLE_MAX_HOURS * 3600);
    expect(cycles[1].sleep).toBeNull();
  });

  it('кольцо сняли на ночь: цикл закрыт в момент снятия, новый — без сна, с пропуском', () => {
    const { cycles } = buildCycles({
      // Кольцо лежит на столе: «сон» без единого замера — не сон.
      sessions: [session(-1, 7), session(23.5, 31)],
      measurements: [...every30(-1, 23), ...every30(31.5, 34)],
      dataStart: at(-1),
      horizon: at(34),
    });
    expect(cycles.map((c) => [c.startedBy, c.endedBy])).toEqual([
      ['wake', 'offBody'],
      ['offBody', null],
    ]);
    expect(cycles[0].end).toBe(at(23));
    expect(cycles[1].before).toEqual({ from: at(23), to: at(31.5) });
    expect(cycles[1].sleep).toBeNull();
  });

  it('кольцо на зарядке днём три часа — тоже снято, время суток не важно', () => {
    const { cycles } = buildCycles({
      sessions: [session(-1, 7)],
      measurements: [...every30(-1, 13), ...every30(16.5, 20)],
      dataStart: at(-1),
      horizon: at(20),
    });
    expect(cycles.map((c) => c.startedBy)).toEqual(['wake', 'offBody']);
  });

  it('два часа без замеров — ещё не снято', () => {
    expect(offBodyGaps([at(10), at(12), at(12.5)], at(13))).toEqual([]);
    expect(offBodyGaps([at(10), at(10 + OFF_BODY_GAP_MIN / 60 + 0.1)], at(14))).toHaveLength(1);
  });

  it('кольцо снято сейчас: текущего цикла нет, известно, с какого момента', () => {
    const { cycles, ringOffSince } = buildCycles({
      sessions: [session(-1, 7)],
      measurements: every30(-1, 15),
      dataStart: at(-1),
      horizon: at(19),
    });
    expect(ringOffSince).toBe(at(15));
    expect(cycles[cycles.length - 1].end).toBe(at(15));
    expect(cycles[cycles.length - 1].endedBy).toBe('offBody');
  });

  it('зарядка вечером, потом сон с кольцом: цикл начат пробуждением, сон засчитан', () => {
    const { cycles } = buildCycles({
      sessions: [session(-1, 7), session(27, 32)],
      measurements: [...every30(-1, 22.5), ...every30(27.2, 34)],
      dataStart: at(-1),
      horizon: at(34),
    });
    const current = cycles[cycles.length - 1];
    expect(current.startedBy).toBe('wake');
    expect(current.sleep?.start).toBe(at(27));
    expect(cycles[0].endedBy).toBe('offBody');
  });

  it('новый пользователь до первого сна: цикл «first» без сна', () => {
    const { cycles } = buildCycles({ sessions: [], measurements: every30(10, 15), dataStart: at(10), horizon: at(15) });
    expect(cycles).toEqual([{ start: at(10), end: null, startedBy: 'first', endedBy: null, sleep: null, before: null }]);
  });
});
