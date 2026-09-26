import { describe, expect, it } from 'vitest';
import { glucoseRises } from './advice-days';
import { flaskState, flaskStats, type FlaskStats } from './flask';
import {
  GLUCOSE_EXERCISE_AFTER_MIN,
  intenseSpans,
  markNotMeal,
  notMealAt,
  sleepSpans,
  type NotMealContext,
} from './glucose';
import { pulseAtShare } from './training';

const STATS: FlaskStats = { gMid: 5.5, gMin: 4.3, nHours: 3 };
/** Ночь 23:00–06:30 на оси сегодняшнего дня. */
const NIGHT: NotMealContext = { sleep: [{ from: -60, to: 390 }], exercise: [] };
/** Тренировка 18:00–18:45. */
const WORKOUT: NotMealContext = { sleep: [], exercise: [{ from: 1080, to: 1125 }] };
const high = (v: number) => v >= 5.5;

describe('СИНТЕТИЧЕСКИЕ: подъём глюкозы не от еды — сон и нагрузка', () => {
  it('во сне и на тренировке (с запасом после её конца) — не еда; днём в покое — могла быть едой', () => {
    expect(notMealAt(330, NIGHT)).toBe('sleep');
    expect(notMealAt(390, NIGHT)).toBe('sleep');
    expect(notMealAt(420, NIGHT)).toBeNull();
    expect(notMealAt(1100, WORKOUT)).toBe('exercise');
    expect(notMealAt(1125 + GLUCOSE_EXERCISE_AFTER_MIN, WORKOUT)).toBe('exercise');
    expect(notMealAt(1125 + GLUCOSE_EXERCISE_AFTER_MIN + 1, WORKOUT)).toBeNull();
    expect(notMealAt(1060, WORKOUT)).toBeNull();
  });

  it('подъём перед пробуждением тянется после подъёма — всё ещё не завтрак; подскок на скачок — уже еда', () => {
    const points = [
      { m: 300, v: 5 },
      { m: 360, v: 6.4 }, // во сне
      { m: 420, v: 6.3 }, // проснулся, сахар ещё не опустился
      { m: 450, v: 7.6 }, // позавтракал: подскок больше 15 % уровня
    ];
    expect(markNotMeal(points, NIGHT, high, 5.5).map((p) => p.notMeal)).toEqual([null, 'sleep', 'sleep', null]);
  });

  it('интенсивная нагрузка — эпизод и одиночный замер пульса от третьей зоны; спокойная ходьба — нет', () => {
    const age = 35;
    const zone3 = pulseAtShare(0.7, age, 60);
    const walk = Array.from({ length: 30 }, (_, i) => ({ m: 600 + i, v: 100 }));
    expect(intenseSpans([{ m: 610, v: 95 }], walk, age, 60)).toEqual([]);
    expect(intenseSpans([{ m: 610, v: zone3 + 5 }], walk, age, 60)).toEqual([
      { from: 600, to: 629 },
      { from: 610, to: 610 },
    ]);
    expect(intenseSpans([{ m: 610, v: zone3 + 5 }], [], null, 60)).toEqual([]);
  });

  it('колба: рассветный подъём во сне не сбрасывает отсчёт — утром жиросжигание, а не «только поел»', () => {
    // Ужин в 19:00 (вчера, −300), дальше сахар ниже среднего, в 05:30 подъём во сне.
    const points = [
      { m: -300, v: 7 },
      { m: -240, v: 5 },
      { m: 120, v: 4.8 },
      { m: 330, v: 6.2 },
      { m: 420, v: 5.2 },
    ];
    const without = flaskState({ points, nowMinute: 450, stats: STATS, calories: null });
    const withSleep = flaskState({ points, nowMinute: 450, stats: STATS, calories: null, notMeal: NIGHT });
    expect(without?.stage).toBe('processing');
    expect(withSleep?.stage).toBe('fat');
    expect(withSleep?.hours).toBeCloseTo((450 + 240) / 60);
  });

  it('колба: поел и сразу уснул — первые два часа сна подъём от еды, колба честно в «Переработке»', () => {
    // Ужин в 13:00 давно переработан; в 23:00 перекус, в 23:10 уснул, замеры уже во сне высокие.
    const points = [
      { m: 780, v: 7 },
      { m: 840, v: 5 },
      { m: 1350, v: 5 }, // 22:30, ещё не спит
      { m: 1410, v: 7.2 }, // 23:30, спит 20 минут
      { m: 1470, v: 6.8 }, // 00:30, спит 80 минут
    ];
    const ctx: NotMealContext = { sleep: sleepSpans([{ from: 1390, to: 1500 }]), exercise: [] };
    const flask = flaskState({ points, nowMinute: 1480, stats: STATS, calories: null, notMeal: ctx });
    expect([flask?.stage, flask?.fill]).toEqual(['processing', 0]);
    // А тот же подъём через три часа сна — уже не еда.
    const late = [...points.slice(0, 3), { m: 1600, v: 7.2 }];
    const lateCtx: NotMealContext = { sleep: sleepSpans([{ from: 1390, to: 1700 }]), exercise: [] };
    expect(flaskState({ points: late, nowMinute: 1610, stats: STATS, calories: null, notMeal: lateCtx })?.stage).toBe('fat');
  });

  it('сессии сна: отрезки гипнограммы с разрывом до двух часов — одна ночь', () => {
    expect(sleepSpans([{ from: 100, to: 200 }, { from: -60, to: 100 }, { from: 250, to: 400 }, { from: 600, to: 700 }])).toEqual([
      { from: -60, to: 400 },
      { from: 600, to: 700 },
    ]);
  });

  it('колба: подъём на тренировке не «еда», а еда после тренировки — да', () => {
    const base = [
      { m: 780, v: 7 }, // обед 13:00
      { m: 840, v: 5 },
      { m: 1110, v: 6.6 }, // на тренировке
    ];
    const onWorkout = flaskState({ points: base, nowMinute: 1140, stats: STATS, calories: null, notMeal: WORKOUT });
    expect(onWorkout?.stage).toBe('fat');
    const dinner = [...base, { m: 1200, v: 7.8 }]; // 20:00, через час с лишним после тренировки
    expect(flaskState({ points: dinner, nowMinute: 1210, stats: STATS, calories: null, notMeal: WORKOUT })?.fill).toBe(0);
  });

  it('личное N: подъём во сне не считается пиком еды', () => {
    const day = [
      { m: 60, v: 5 },
      { m: 300, v: 7 }, // во сне
      { m: 540, v: 5 }, // через 4 часа
      { m: 780, v: 7 }, // обед
      { m: 900, v: 5 }, // через 2 часа
    ];
    const ctx: NotMealContext = { sleep: [{ from: 0, to: 420 }], exercise: [] };
    expect(flaskStats([day]).nHours).toBeCloseTo(3); // (4 + 2) / 2
    expect(flaskStats([day], [ctx]).nHours).toBeCloseTo(2);
  });

  it('время еды для Лиса: рассветный подъём и подъём на тренировке — не приёмы пищи', () => {
    const points = [
      { m: 240, v: 6 },
      { m: 330, v: 7.2 }, // во сне
      { m: 480, v: 6 },
      { m: 540, v: 7.4 }, // завтрак
      { m: 600, v: 6 },
      { m: 1100, v: 7.3 }, // тренировка
      { m: 1200, v: 6 },
    ];
    const ctx: NotMealContext = { sleep: [{ from: -60, to: 400 }], exercise: [{ from: 1080, to: 1125 }] };
    expect(glucoseRises(points, 6)).toEqual([330, 540, 1100]);
    expect(glucoseRises(points, 6, ctx)).toEqual([540]);
  });
});
