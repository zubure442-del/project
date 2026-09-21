import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPECTED_MS,
  FINISH_HOLD_MS,
  INITIAL_PROGRESS,
  QUICK_MIN_MS,
  SLIDE_MAX_MS,
  SLIDE_MIN_MS,
  currentSlide,
  expectedDuration,
  leaveAt,
  realPercent,
  recordDuration,
  slideCaption,
  slideInterval,
  statusText,
  type LoadProgress,
} from './loading';

const run = (p: Partial<LoadProgress>): LoadProgress => ({ ...INITIAL_PROGRESS, slides: true, intervalMs: 10000, ...p });

describe('СИНТЕТИЧЕСКИЕ: интервал карточек', () => {
  it('без истории — ожидаем 40 с, карточка по 10 с', () => {
    expect(expectedDuration([])).toBe(DEFAULT_EXPECTED_MS);
    expect(slideInterval([])).toBe(10000);
  });

  it('медиана последних трёх удачных загрузок', () => {
    expect(expectedDuration([90000, 20000, 36000, 30000])).toBe(30000);
    expect(slideInterval([20000, 36000, 30000])).toBe(7500);
  });

  it('интервал в пределах 4–12 с', () => {
    expect(slideInterval([8000])).toBe(SLIDE_MIN_MS);
    expect(slideInterval([100000])).toBe(SLIDE_MAX_MS);
  });

  it('в истории остаются три последних', () => {
    expect(recordDuration([1, 2, 3], 4)).toEqual([2, 3, 4]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: листание карточек', () => {
  it('карточки идут равными интервалами, не глядя на этапы загрузки', () => {
    expect(currentSlide(run({ stage: 2 }), 0)).toBe(1);
    expect(currentSlide(run({ stage: 2 }), 9999)).toBe(1);
    expect(currentSlide(run({ stage: 1 }), 10000)).toBe(2);
    expect(currentSlide(run({ stage: 2 }), 35000)).toBe(4);
  });

  it('загрузка дольше всех карточек: остаётся четвёртая с «Почти готово»', () => {
    expect(currentSlide(run({}), 55000)).toBe(4);
    expect(slideCaption(run({}), 55000)).toBe('Почти готово');
    expect(slideCaption(run({}), 15000)).toBe('Шаг 2 из 4');
  });

  it('загрузка кончилась раньше: текущая карточка держится не дольше 2.5 с', () => {
    // Вторая карточка только началась — ждём полные 2.5 с.
    expect(leaveAt(run({ finished: true, finishedAt: 10500 }))).toBe(10500 + FINISH_HOLD_MS);
    // До конца карточки 0.5 с — уходим, когда она кончится.
    expect(leaveAt(run({ finished: true, finishedAt: 19500 }))).toBe(20000);
    // Четвёртая: ещё 2.5 с.
    expect(leaveAt(run({ finished: true, finishedAt: 52000 }))).toBe(52000 + FINISH_HOLD_MS);
    // После конца загрузки листание останавливается.
    expect(currentSlide(run({ finished: true, finishedAt: 10500 }), 12900)).toBe(2);
  });

  it('пока загрузка идёт, уходить нельзя', () => {
    expect(leaveAt(run({ stage: 3 }))).toBeNull();
  });

  it('быстрый экран без карточек: сразу после конца, но не короче 1.2 с', () => {
    expect(leaveAt(run({ slides: false, finished: true, finishedAt: 300 }))).toBe(QUICK_MIN_MS);
    expect(leaveAt(run({ slides: false, finished: true, finishedAt: 9000 }))).toBe(9400);
  });
});

describe('СИНТЕТИЧЕСКИЕ: настоящий статус', () => {
  it('«Подключаемся…», потом «Загружаем данные · N %»', () => {
    expect(statusText(run({ stage: 1 }), 0.05)).toBe('Подключаемся…');
    const p = run({ stage: 2, fraction: 0.4 });
    expect(realPercent(p)).toBeCloseTo(0.42);
    expect(statusText(p, realPercent(p))).toBe('Загружаем данные · 42 %');
    expect(realPercent(run({ finished: true }))).toBe(1);
  });
});
