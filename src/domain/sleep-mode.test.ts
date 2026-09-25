import { describe, expect, it } from 'vitest';
import {
  BEDTIME_MAX_SHIFT_EARLIER_MIN,
  SLEEP_NEED_DEFAULT_MIN,
  baseSleepNeed,
  sleepDebt,
  sleepMode,
  type SleepNight,
} from './sleep-mode';

/** Ночь: сколько спал (часы), оценка, подъём (часы), доля сна от времени в постели 0.9. */
const night = (hours: number, score: number | null = 80, wake = 7): SleepNight => ({
  sleptMin: hours * 60,
  spanMin: Math.round((hours * 60) / 0.9),
  score,
  wakeMinute: wake * 60,
});
const hh = (h: number, m = 0) => h * 60 + m;

describe('СИНТЕТИЧЕСКИЕ: «Режим сна»', () => {
  it('своя база — по лучшим ночам, в рамках 7–9 часов; мало ночей — 7.5 часа', () => {
    expect(baseSleepNeed([night(7.5), night(8.5, 95), night(6, 40), night(8, 90)])).toBe(hh(8, 15));
    expect(baseSleepNeed([night(10, 99), night(10, 98), night(10, 97)])).toBe(hh(9));
    expect(baseSleepNeed([night(8)])).toBe(SLEEP_NEED_DEFAULT_MIN);
  });

  it('долг — недосып за три последние ночи против своей базы', () => {
    expect(sleepDebt([night(8), night(6.5), night(7), night(7.5)], hh(7, 30))).toBe(60 + 30);
  });

  it('выспался: окно от обычного подъёма, долга нет', () => {
    const plan = sleepMode({
      nights: [night(7.5), night(7.5), night(7.5), night(7.5)],
      usualBedtime: hh(23),
      activity: 0,
      nowMinute: hh(14),
    });
    // 7.5 ч сна / 0.9 + 15 мин засыпания = 8 ч 35 мин в постели до подъёма в 7:00 → лечь в 22:25.
    expect(plan.wake).toBe(1440 + hh(7));
    expect([plan.from, plan.to]).toEqual([hh(22, 10), hh(22, 40)]);
    expect(plan.windDown).toBe(hh(21, 10));
    expect(plan.debtMin).toBe(0);
    expect(plan.repayNights).toBe(0);
    expect(plan.phase).toBe('day');
  });

  it('долг и активный день добавляют сна, но не больше часа долга за ночь', () => {
    const rested = sleepMode({ nights: [night(7.5), night(7.5), night(7.5)], usualBedtime: hh(23), activity: 0, nowMinute: 0 });
    const tired = sleepMode({ nights: [night(7.5), night(5), night(5)], usualBedtime: hh(23), activity: 100, nowMinute: 0 });
    expect(tired.debtMin).toBe(300);
    expect(tired.needMin - rested.needMin).toBe(60 + 40);
  });

  it('раньше привычного больше чем на час не ложимся — большой долг возвращается за несколько ночей', () => {
    const plan = sleepMode({ nights: [night(8), night(4), night(4)], usualBedtime: hh(24, 30), activity: 50, nowMinute: 0 });
    expect((plan.from + plan.to) / 2).toBe(hh(24, 30) - BEDTIME_MAX_SHIFT_EARLIER_MIN);
    // Долг 8 ч; план упирается в предел и почти ничего не даёт сверх базы — считаем по 30 минут за ночь.
    expect(plan.debtMin).toBe(480);
    expect(plan.repayNights).toBe(16);
  });

  it('долг и число ночей: план даёт час сверх базы — долг 1.5 часа уходит за 2 ночи', () => {
    const plan = sleepMode({ nights: [night(8, 95), night(7.25), night(7.25)], usualBedtime: hh(22), activity: 0, nowMinute: 0 });
    expect(plan.debtMin).toBe(90);
    expect(plan.repayNights).toBe(2);
  });

  it('состояние по часам: день → пора сбавлять темп → лучшее время → окно прошло', () => {
    const at = (nowMinute: number) =>
      sleepMode({ nights: [night(7.5), night(7.5), night(7.5)], usualBedtime: hh(23), activity: 0, nowMinute }).phase;
    expect(at(hh(20))).toBe('day');
    expect(at(hh(21, 30))).toBe('windDown');
    expect(at(hh(22, 20))).toBe('bedtime');
    expect(at(hh(23, 30))).toBe('late');
  });
});
