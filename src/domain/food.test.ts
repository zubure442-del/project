import { describe, expect, it } from 'vitest';
import {
  AUTOPHAGY_AFTER_HOURS,
  FASTING_LOOKBACK_HOURS,
  FOOD_MODE,
  FOOD_SCHEDULE,
  FOOD_SLEEP_OK,
  autophagyMinutes,
  autophagyText,
  fastingStart,
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

describe('СИНТЕТИЧЕСКИЕ: точка отсчёта голодания и аутофагия', () => {
  const onset = -60; // уснул в 23:00 накануне

  it('минимум глюкозы в последние четыре часа перед сном', () => {
    const points = [
      { m: -400, glucose: 4.2 }, // раньше окна
      { m: -200, glucose: 5.5 },
      { m: -120, glucose: 4.9 }, // минимум в окне
      { m: 60, glucose: 4.4 }, // уже во сне
    ];
    expect(fastingStart(points, onset)).toBe(-120);
    expect(FASTING_LOOKBACK_HOURS).toBe(4);
  });

  it('замеров в окне нет — считаем от засыпания', () => {
    expect(fastingStart([{ m: -500, glucose: 4.2 }], onset)).toBe(onset);
    expect(fastingStart([], onset)).toBe(onset);
  });

  it('часы аутофагии: от точки отсчёта до «сейчас» минус двенадцать', () => {
    const start = -120;
    const firstMeal = 12 * 60;
    // 10:40 — это 640 минут; 640 − (−120) = 760 минут без еды, минус 12 часов = 40 минут.
    expect(autophagyMinutes({ fastingStart: start, firstMeal, nowMinute: 640 })).toBe(40);
    expect(AUTOPHAGY_AFTER_HOURS).toBe(12);
  });

  it('после первого приёма счётчик замирает на времени еды', () => {
    const start = 0;
    const firstMeal = 13 * 60;
    const atMeal = autophagyMinutes({ fastingStart: start, firstMeal, nowMinute: firstMeal });
    expect(autophagyMinutes({ fastingStart: start, firstMeal, nowMinute: 20 * 60 })).toBe(atMeal);
    expect(atMeal).toBe(60);
  });

  it('меньше двенадцати часов без еды — ноль часов', () => {
    expect(autophagyMinutes({ fastingStart: 0, firstMeal: 600, nowMinute: 300 })).toBe(0);
    // Хвост одинаковый при любом значении, в том числе при нуле.
    expect(autophagyText(0)).toBe('0 часов аутофагии по итогам ночного отдыха');
    expect(autophagyText(-30)).toBe('0 часов аутофагии по итогам ночного отдыха');
  });

  it('формат счётчика', () => {
    expect(autophagyText(220)).toBe('3 часа 40 минут аутофагии по итогам ночного отдыха');
    expect(autophagyText(60)).toBe('1 час аутофагии по итогам ночного отдыха');
    expect(autophagyText(41)).toBe('41 минута аутофагии по итогам ночного отдыха');
  });
});

describe('СИНТЕТИЧЕСКИЕ: карточка целиком', () => {
  it('собирает режим, расписание и счётчик', () => {
    const card = foodCycle({
      wakeMinute: 7 * 60,
      sleepOnset: -60,
      sleepScore: 85,
      glucose: NORM,
      baseline: NORM,
      fastingStart: -120,
      nowMinute: 11 * 60,
    });
    expect(card.mode).toBe('base');
    expect(card.title).toBe(FOOD_MODE.base.title);
    expect(card.firstMeal).toBe(12 * 60);
    expect(card.meals).toHaveLength(2);
    // 11:00 − (−2:00) = 13 часов без еды: час аутофагии.
    expect(card.autophagy).toBe(60);
    expect(card.autophagyText).toContain('аутофагии');
  });
});
