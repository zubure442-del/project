import { describe, expect, it } from 'vitest';
import { sleepScore } from './score';
import type { SleepSession } from './sleep';
import {
  NORMAL_RANGE,
  SIGNIFICANT_THRESHOLD,
  SLEEP_HR_BASELINE_MIN_NIGHTS,
  SLEEP_HR_CATEGORY,
  SLEEP_HR_NO_BASELINE_TEXT,
  SLEEP_SCORE_MAX,
  applySleepHrFactor,
  nightHrOf,
  sleepHrBaseline,
  sleepHrCategory,
  sleepHrCheck,
  sleepHrDeltaText,
  sleepHrFactor,
} from './sleep-hr';

const night = (min: number, avg: number) => ({ min, avg });

describe('СИНТЕТИЧЕСКИЕ: своя норма ночного пульса за 7 дней', () => {
  it('ночей меньше минимума — нормы нет', () => {
    expect(sleepHrBaseline([night(50, 58), night(51, 59)])).toBeNull();
    expect(sleepHrBaseline(new Array(SLEEP_HR_BASELINE_MIN_NIGHTS - 1).fill(night(50, 58)))).toBeNull();
  });

  it('норма — среднее минимумов и среднее средних, окно семь дней', () => {
    expect(sleepHrBaseline(new Array(SLEEP_HR_BASELINE_MIN_NIGHTS).fill(night(49, 60)))).toEqual({ min: 49, avg: 60 });
    // Восемь ночей: самая старая в норму не входит.
    const nights = [night(90, 90), ...new Array(7).fill(night(50, 60))];
    expect(sleepHrBaseline(nights)).toEqual({ min: 50, avg: 60 });
  });

  it('ночь считается по замерам: минимум и среднее; замеров мало — ночи нет', () => {
    expect(nightHrOf([60, 48, 54])).toEqual({ min: 48, avg: 54 });
    expect(nightHrOf([60, 48])).toBeNull();
  });
});

describe('СИНТЕТИЧЕСКИЕ: пять категорий по отклонениям минимума и среднего', () => {
  const N = NORMAL_RANGE;
  const S = SIGNIFICANT_THRESHOLD;

  it('1. всё в норме: оба отклонения в коридоре', () => {
    expect(sleepHrCategory(0, 0)).toBe('normal');
    expect(sleepHrCategory(N, -N)).toBe('normal');
  });

  it('2. повышенная нагрузка: оба выше', () => {
    expect(sleepHrCategory(S, S)).toBe('load');
    expect(sleepHrCategory(12, 9)).toBe('load');
  });

  it('3. глубокое расслабление: минимум ниже, среднее ниже или в коридоре', () => {
    expect(sleepHrCategory(-S, -S)).toBe('deep');
    expect(sleepHrCategory(-8, 0)).toBe('deep');
    expect(sleepHrCategory(-8, N)).toBe('deep');
  });

  it('4. неравномерный ритм: минимум ниже, среднее выше', () => {
    expect(sleepHrCategory(-S, S)).toBe('uneven');
  });

  it('5. ускорение под утро: минимум выше, среднее ниже или в коридоре', () => {
    expect(sleepHrCategory(S, 0)).toBe('spike');
    expect(sleepHrCategory(9, -S)).toBe('spike');
  });

  it('пограничный случай — «смешанная картина», оценку сна не трогаем', () => {
    // Минимум как обычно, а среднее заметно выше: ни одна из пяти картин не подходит.
    expect(sleepHrCategory(0, S)).toBe('mixed');
    expect(sleepHrCategory(0, -S)).toBe('mixed');
    expect(SLEEP_HR_CATEGORY.mixed.factor).toBe(1);
  });

  it('коэффициенты категорий — как договорились', () => {
    expect(SLEEP_HR_CATEGORY.normal.factor).toBe(1);
    expect(SLEEP_HR_CATEGORY.load.factor).toBe(0.75);
    expect(SLEEP_HR_CATEGORY.deep.factor).toBe(1.25);
    expect(SLEEP_HR_CATEGORY.uneven.factor).toBe(0.5);
    expect(SLEEP_HR_CATEGORY.spike.factor).toBe(1);
    expect(sleepHrFactor(null)).toBe(1);
  });
});

describe('СИНТЕТИЧЕСКИЕ: карточка «Пульс во сне»', () => {
  const baseline = night(50, 58);

  it('показывает отклонения и текст категории', () => {
    const view = sleepHrCheck(night(48, 63), baseline);
    expect(view).toMatchObject({ deltaMin: -2, deltaAvg: 5, category: 'mixed' });
    expect(sleepHrDeltaText(view?.deltaMin as number)).toBe('-2 от вашей нормы');
    expect(sleepHrDeltaText(view?.deltaAvg as number)).toBe('+5 от вашей нормы');
    expect(sleepHrDeltaText(0)).toBe('как обычно');
  });

  it('высокий минимум и высокое среднее — повышенная нагрузка', () => {
    const view = sleepHrCheck(night(58, 66), baseline);
    expect(view?.category).toBe('load');
    expect(view?.title).toBe(SLEEP_HR_CATEGORY.load.title);
    expect(view?.factor).toBe(0.75);
  });

  it('точка вместо заголовка: зелёная при спокойной ночи, красная при отклонении', () => {
    expect(sleepHrCheck(night(50, 58), baseline)?.tone).toBe('good'); // всё в норме
    expect(sleepHrCheck(night(44, 52), baseline)?.tone).toBe('good'); // глубокое расслабление
    expect(sleepHrCheck(night(58, 66), baseline)?.tone).toBe('alert'); // повышенная нагрузка
    expect(sleepHrCheck(night(44, 64), baseline)?.tone).toBe('alert'); // рваный ритм
    expect(sleepHrCheck(night(50, 64), baseline)?.tone).toBe('alert'); // смешанная картина
    expect(sleepHrCheck(night(50, 58), null)?.tone).toBe('unknown'); // нормы ещё нет
  });

  it('нормы ещё нет — только числа, без выводов', () => {
    const view = sleepHrCheck(night(48, 63), null);
    expect(view).toMatchObject({ deltaMin: null, deltaAvg: null, category: null, title: null, tone: 'unknown', factor: 1 });
    expect(view?.text).toBe(SLEEP_HR_NO_BASELINE_TEXT);
  });

  it('ночи нет — карточки нет', () => {
    expect(sleepHrCheck(null, baseline)).toBeNull();
  });
});

describe('СИНТЕТИЧЕСКИЕ: коэффициент в оценке сна и предел 100 очков', () => {
  it('множитель не выводит оценку за 100 и за 0', () => {
    expect(applySleepHrFactor(90, 1.25)).toBe(SLEEP_SCORE_MAX);
    expect(applySleepHrFactor(60, 1.25)).toBe(75);
    expect(applySleepHrFactor(80, 0.5)).toBe(40);
    expect(applySleepHrFactor(0, 1.25)).toBe(0);
  });

  it('оценка сна умножается на коэффициент категории', () => {
    // Ночь 7 часов: базовая оценка высокая, чтобы 1.25 упёрлось в предел.
    const session: SleepSession = {
      date: '2026-09-21',
      start: Date.parse('2026-09-20T23:00:00Z') / 1000,
      end: Date.parse('2026-09-21T06:00:00Z') / 1000,
      deepMin: 84,
      lightMin: 336,
      awakeMin: 0,
    };
    const base = sleepScore(session) as number;
    expect(sleepScore(session, { nightHrFactor: 0.5 })).toBeCloseTo(base * 0.5, 6);
    expect(sleepScore(session, { nightHrFactor: 1.25 })).toBe(Math.min(SLEEP_SCORE_MAX, base * 1.25));
    expect(sleepScore(session, { nightHrFactor: 1.25 })).toBeLessThanOrEqual(SLEEP_SCORE_MAX);
  });
});
