import { describe, expect, it } from 'vitest';
import {
  FOOD_MODE,
  FOOD_SCHEDULE,
  FOOD_SLEEP_OK,
  foodCycle,
  foodMeals,
  foodMode,
  median,
  nightGlucose,
} from './food';

const NORM = 5;

describe('СИНТЕТИЧЕСКИЕ: личная норма ночной глюкозы', () => {
  it('медиана устойчива к одиночному выбросу', () => {
    expect(median([4.8, 5, 5.2])).toBe(5);
    expect(median([4.8, 5, 5.2, 12])).toBeCloseTo(5.1, 6);
    expect(median([])).toBeNull();
  });

  it('ночные замеры — только внутри сна и без активности рядом', () => {
    const segments = [{ from: -60, to: 420 }];
    const points = [
      { m: 60, glucose: 5.1 }, // спит, тихо — берём
      { m: 200, glucose: 5.3 }, // спит, но рядом шаги — не берём
      { m: 600, glucose: 6.4 }, // уже день — не берём
      { m: 90, glucose: null }, // замера нет
    ];
    const steps = [{ m: 202, v: 40 }];
    expect(nightGlucose(points, segments, steps)).toEqual([5.1]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: режим «Цикла питания»', () => {
  const high = NORM * 1.3; // +30 %
  const low = NORM * 0.85; // −15 %

  it('глюкоза выше +25 % при хорошем сне — подозрение на гипергликемию', () => {
    expect(foodMode({ sleepScore: 80, glucose: high, baseline: NORM })).toBe('hyper');
  });

  it('плохой сон важнее высокой глюкозы: режим восстановления', () => {
    expect(foodMode({ sleepScore: FOOD_SLEEP_OK, glucose: high, baseline: NORM })).toBe('recovery');
    expect(foodMode({ sleepScore: 50, glucose: NORM, baseline: NORM })).toBe('recovery');
  });

  it('глюкоза ниже −10 % — тоже восстановление', () => {
    expect(foodMode({ sleepScore: 90, glucose: low, baseline: NORM })).toBe('recovery');
  });

  it('хороший сон и глюкоза в коридоре — базовый режим', () => {
    expect(foodMode({ sleepScore: 90, glucose: NORM * 1.2, baseline: NORM })).toBe('base');
    expect(foodMode({ sleepScore: 90, glucose: NORM * 0.95, baseline: NORM })).toBe('base');
    // Границы коридора включительно: ровно −10 % и ровно +25 % — ещё норма.
    expect(foodMode({ sleepScore: 90, glucose: NORM * 0.9, baseline: NORM })).toBe('base');
    expect(foodMode({ sleepScore: 90, glucose: NORM * 1.25, baseline: NORM })).toBe('base');
  });

  it('глюкозы нет — режим по одному сну', () => {
    expect(foodMode({ sleepScore: 90, glucose: null, baseline: null })).toBe('base');
    expect(foodMode({ sleepScore: 40, glucose: null, baseline: null })).toBe('recovery');
  });
});

describe('СИНТЕТИЧЕСКИЕ: расписание приёмов пищи', () => {
  const wake = 7 * 60;

  it('базовый: два приёма — через 5 часов и ещё через 5.5', () => {
    const meals = foodMeals('base', wake);
    expect(meals.map((m) => m.minute)).toEqual([wake + 300, wake + 300 + 330]);
    expect(FOOD_SCHEDULE.base.gapAfterFirst).toBe(5.5);
  });

  it('гипергликемия: через 5 и через 10 часов от подъёма', () => {
    expect(foodMeals('hyper', wake).map((m) => m.minute)).toEqual([wake + 300, wake + 600]);
  });

  it('восстановление: три приёма по серединам диапазонов', () => {
    const meals = foodMeals('recovery', wake);
    expect(meals.map((m) => m.minute)).toEqual([wake + 75, wake + 390, wake + 690]);
    expect(meals.map((m) => m.title)).toEqual(['Завтрак', 'Обед', 'Ужин']);
  });
});

describe('СИНТЕТИЧЕСКИЕ: карточка целиком', () => {
  it('собирает режим, расписание и колбу', () => {
    const flask = { stage: 'fat' as const, fill: 40, hours: 6, effectiveHours: 0, glucose: 4.6 };
    const card = foodCycle({
      wakeMinute: 7 * 60,
      sleepOnset: -60,
      sleepScore: 85,
      glucose: NORM,
      baseline: NORM,
      flask,
      nowMinute: 11 * 60,
    });
    expect(card.mode).toBe('base');
    expect(card.title).toBe(FOOD_MODE.base.title);
    expect(card.meals.map((m) => m.minute)).toEqual([12 * 60, 12 * 60 + 330]);
    expect(card.flask).toBe(flask);
  });
});
