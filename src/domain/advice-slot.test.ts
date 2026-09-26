import { describe, expect, it } from 'vitest';
import { ADVICE_DEFAULT_BEDTIME_MIN, ADVICE_EVENING_BEFORE_BED_MIN, ADVICE_MORNING_MIN, adviceSlot } from './report';

const at = (h: number, m = 0) => h * 60 + m;

describe('СИНТЕТИЧЕСКИЕ: три мнения Лиса за цикл — после пробуждения, днём, перед сном', () => {
  it('подъём в 7:00, окно сна с 23:00: утро до 11:00, день до 20:00, дальше вечер', () => {
    const slot = (now: number) => adviceSlot({ wakeMinute: at(7), bedtimeMinute: at(23), nowMinute: now });
    expect(slot(at(7, 5))).toBe('morning');
    expect(slot(at(10, 59))).toBe('morning');
    expect(slot(at(11))).toBe('day');
    expect(slot(at(19, 59))).toBe('day');
    expect(slot(at(20))).toBe('evening');
    expect(slot(1440 + at(0, 30))).toBe('evening');
  });

  it('по ритму человека, а не по часам: сова с подъёмом в 11:00 и сном в 2:00 — утро до 15:00, вечер с 23:00', () => {
    const slot = (now: number) => adviceSlot({ wakeMinute: at(11), bedtimeMinute: 1440 + at(2), nowMinute: now });
    expect(slot(at(14))).toBe('morning');
    expect(slot(at(15))).toBe('day');
    expect(slot(at(22, 59))).toBe('day');
    expect(slot(at(23))).toBe('evening');
  });

  it('утро важнее: встал поздно — первые 4 часа всё равно утро; окна сна нет — ложимся в 23:00', () => {
    expect(adviceSlot({ wakeMinute: at(18), bedtimeMinute: at(23), nowMinute: at(21) })).toBe('morning');
    expect(adviceSlot({ wakeMinute: at(18), bedtimeMinute: at(23), nowMinute: at(22) })).toBe('evening');
    expect(adviceSlot({ wakeMinute: at(7), bedtimeMinute: null, nowMinute: ADVICE_DEFAULT_BEDTIME_MIN - ADVICE_EVENING_BEFORE_BED_MIN })).toBe('evening');
    expect(ADVICE_MORNING_MIN).toBe(240);
  });
});
