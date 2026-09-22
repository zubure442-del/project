import { describe, expect, it } from 'vitest';
import {
  COFFEE_CUPS_TEXT,
  COFFEE_CUPS_THREE_FROM,
  COFFEE_CUPS_TWO_FROM,
  COFFEE_TEXT,
  DEFAULT_BEDTIME_MIN,
  averageBedtime,
  coffeeCups,
  coffeeWindow,
  type CoffeeInput,
} from './coffee';

/** Подъём в 7:00, оценка сна 80, обычно ложится в 23:00. */
const base: CoffeeInput = { wakeMinute: 420, sleepScore: 80, bedtimes: [1380, 1380, 1380], nowMinute: 600 };

describe('СИНТЕТИЧЕСКИЕ: кофейное окно', () => {
  it('START = подъём + 90 мин, CUTOFF = обычный отход ко сну − 8 ч', () => {
    const w = coffeeWindow(base);
    expect(w).toMatchObject({ kind: 'window', start: 510, cutoff: 900 });
  });

  it('истории отхода ко сну нет — 22:00', () => {
    expect(averageBedtime([])).toBe(DEFAULT_BEDTIME_MIN);
    expect(coffeeWindow({ ...base, bedtimes: [] })).toMatchObject({ cutoff: 22 * 60 - 480 });
  });

  it('таймлайн при любой оценке сна: низкой, средней и высокой', () => {
    for (const sleepScore of [0, 30, 59, 60, 75, 89, 90, 100]) {
      expect(coffeeWindow({ ...base, sleepScore })).toMatchObject({ kind: 'window', start: 510, cutoff: 900 });
    }
  });

  it('до окна — «Окно откроется в …», в окне — «открыто до …»', () => {
    expect(coffeeWindow({ ...base, nowMinute: 450 })).toMatchObject({ phase: 'before', text: 'Окно откроется в 08:30' });
    expect(coffeeWindow({ ...base, nowMinute: 600 })).toMatchObject({ phase: 'open', text: 'Окно открыто до 15:00' });
  });

  it('после окна и ночью — «Сейчас не время для кофе…»', () => {
    expect(coffeeWindow({ ...base, nowMinute: 1000 })).toMatchObject({ phase: 'after', text: COFFEE_TEXT.closed });
    expect(coffeeWindow({ ...base, nowMinute: 120 })).toMatchObject({ phase: 'after', text: COFFEE_TEXT.closed });
  });

  it('старт позже отсечки — «Сегодня лучше без кофе», совета по чашкам нет', () => {
    expect(coffeeWindow({ ...base, wakeMinute: 840 })).toMatchObject({ kind: 'no-window', text: COFFEE_TEXT.noWindow, cups: null });
  });

  it('в текстах нет слова «кофеин»', () => {
    expect([...Object.values(COFFEE_TEXT), ...Object.values(COFFEE_CUPS_TEXT)].join(' ')).not.toMatch(/кофеин/i);
  });
});

describe('СИНТЕТИЧЕСКИЕ: число чашек по оценке сна', () => {
  it('пороги — именованные константы 60 и 90', () => {
    expect(COFFEE_CUPS_TWO_FROM).toBe(60);
    expect(COFFEE_CUPS_THREE_FROM).toBe(90);
  });

  it('сон < 60 → 1, 60–89 → 2, 90–100 → 3', () => {
    expect([0, 30, 59].map(coffeeCups)).toEqual([1, 1, 1]);
    expect([60, 75, 89].map(coffeeCups)).toEqual([2, 2, 2]);
    expect([90, 95, 100].map(coffeeCups)).toEqual([3, 3, 3]);
  });

  it('текст под таймлайном — ровно по N', () => {
    expect(coffeeWindow({ ...base, sleepScore: 45 }).cups).toEqual({
      n: 1,
      text: 'На основе вашего сна рекомендуем не более 1 чашки сегодня, чтобы восстановить силы и не нарушить засыпание вечером.',
    });
    expect(coffeeWindow({ ...base, sleepScore: 60 }).cups).toEqual({
      n: 2,
      text: 'На основе вашего сна рекомендуем не более 2 чашек сегодня, чтобы восстановить силы и не нарушить засыпание вечером.',
    });
    expect(coffeeWindow({ ...base, sleepScore: 90 }).cups).toEqual({
      n: 3,
      text: 'На основе вашего сна рекомендуем не более 3 чашек сегодня, чтобы восстановить силы и не нарушить засыпание вечером.',
    });
  });

  it('совет по чашкам — в любой фазе окна, в том числе когда окно уже закрыто', () => {
    for (const nowMinute of [120, 450, 600, 1000]) {
      expect(coffeeWindow({ ...base, sleepScore: 70, nowMinute }).cups?.n).toBe(2);
    }
  });
});
