import { describe, expect, it } from 'vitest';
import { COFFEE_TEXT, DEFAULT_BEDTIME_MIN, averageBedtime, coffeeWindow, type CoffeeInput } from './coffee';

/** Подъём в 7:00, сон 7 часов с оценкой 80, обычно ложится в 23:00. */
const base: CoffeeInput = { wakeMinute: 420, sleepScore: 80, sleepMinutes: 420, bedtimes: [1380, 1380, 1380], nowMinute: 600 };

describe('СИНТЕТИЧЕСКИЕ: кофейное окно', () => {
  it('START = подъём + 90 мин, CUTOFF = обычный отход ко сну − 8 ч', () => {
    const w = coffeeWindow(base);
    expect(w).toMatchObject({ kind: 'window', start: 510, cutoff: 900 });
  });

  it('истории отхода ко сну нет — 22:00', () => {
    expect(averageBedtime([])).toBe(DEFAULT_BEDTIME_MIN);
    expect(coffeeWindow({ ...base, bedtimes: [] })).toMatchObject({ cutoff: 22 * 60 - 480 });
  });

  it('короткий или неглубокий сон — предупреждение вместо таймлайна', () => {
    expect(coffeeWindow({ ...base, sleepScore: 49 }).kind).toBe('poor-sleep');
    expect(coffeeWindow({ ...base, sleepMinutes: 5.5 * 60 - 1 }).kind).toBe('poor-sleep');
    expect(coffeeWindow({ ...base, sleepScore: 50, sleepMinutes: 330 }).kind).toBe('window');
    expect(coffeeWindow({ ...base, sleepScore: 30 }).text).toBe(COFFEE_TEXT.poorSleep);
  });

  it('до окна — «Окно откроется в …», в окне — «открыто до …»', () => {
    expect(coffeeWindow({ ...base, nowMinute: 450 })).toMatchObject({ phase: 'before', text: 'Окно откроется в 08:30' });
    expect(coffeeWindow({ ...base, nowMinute: 600 })).toMatchObject({ phase: 'open', text: 'Окно открыто до 15:00' });
  });

  it('после окна и ночью — «Сейчас не время для кофе…»', () => {
    expect(coffeeWindow({ ...base, nowMinute: 1000 })).toMatchObject({ phase: 'after', text: COFFEE_TEXT.closed });
    expect(coffeeWindow({ ...base, nowMinute: 120 })).toMatchObject({ phase: 'after', text: COFFEE_TEXT.closed });
  });

  it('старт позже отсечки — «Сегодня лучше без кофе»; сна нет вовсе — «Кольцо ещё не записало сон»', () => {
    expect(coffeeWindow({ ...base, wakeMinute: 840 })).toMatchObject({ kind: 'no-window', text: COFFEE_TEXT.noWindow });
    expect(coffeeWindow({ ...base, wakeMinute: null })).toEqual({ kind: 'no-sleep', text: COFFEE_TEXT.noSleep });
  });

  it('в текстах нет слова «кофеин»', () => {
    expect(Object.values(COFFEE_TEXT).join(' ')).not.toMatch(/кофеин/i);
  });
});
