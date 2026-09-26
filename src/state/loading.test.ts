import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEGMENT_MS,
  INITIAL_PROGRESS,
  QUICK_MIN_MS,
  SLIDE_MIN_MS,
  canLeave,
  expectedMs,
  loadPlan,
  loadSegments,
  nextSlide,
  plannedPercent,
  recordDurations,
  runsInBackground,
  slideCaption,
  slideForPercent,
  statusText,
  wantsSlides,
  type LoadProgress,
  type ShownSlide,
} from './loading';

const run = (p: Partial<LoadProgress>): LoadProgress => ({ ...INITIAL_PROGRESS, slides: true, plan: loadPlan(7, {}), ...p });

describe('СИНТЕТИЧЕСКИЕ: процент по ожидаемым длительностям', () => {
  it('по умолчанию 9 с на день из четырёх запросов', () => {
    expect(expectedMs('heart', {})).toBe(2250);
    expect(loadSegments(2)).toEqual(['connect', 'steps', 'heart', 'summary', 'spo2', 'steps', 'heart', 'summary', 'spo2', 'extras', 'finalize']);
  });

  it('ожидаемая длительность — медиана трёх последних загрузок', () => {
    expect(expectedMs('heart', { heart: [9000, 1000, 5000, 3000] })).toBe(3000);
    expect(recordDurations({ heart: [1, 2, 3] }, { heart: [10, 20] }).heart).toEqual([2, 3, 15]);
  });

  it('процент растёт по времени равномерно, а не рывками по числу запросов', () => {
    const plan = [4000, 2000, 2000, 2000];
    const p = run({ plan, startedAt: 0, segment: 0, segmentStartedAt: 0 });
    expect(plannedPercent(p, 2000)).toBeCloseTo(0.2);
    // Часть идёт дольше ожидаемого — застываем на 95 % её доли, но назад не уходим.
    expect(plannedPercent(p, 60000)).toBeCloseTo(0.38);
    expect(plannedPercent({ ...p, segment: 2, segmentStartedAt: 7000 }, 8000)).toBeCloseTo(0.7);
    expect(plannedPercent({ ...p, finished: true }, 0)).toBe(1);
  });
});

describe('СИНТЕТИЧЕСКИЕ: слайды по проценту', () => {
  it('слайд k — пока процент в [25(k−1), 25k)', () => {
    expect([0, 0.13, 0.25, 0.49, 0.5, 0.75, 1].map(slideForPercent)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  it('третий не появится на 13 %, как раньше', () => {
    let shown: ShownSlide = { slide: 1, since: 0 };
    for (let t = 0; t <= 20000; t += 100) shown = nextSlide(shown, 0.13, t);
    expect(shown.slide).toBe(1);
  });

  it('процент перескочил — слайды идут по очереди, не чаще раза в 3 с', () => {
    let shown: ShownSlide = { slide: 1, since: 0 };
    const changes: number[] = [];
    for (let t = 0; t <= 20000; t += 100) {
      const next = nextSlide(shown, 0.9, t);
      if (next !== shown) changes.push(t);
      shown = next;
    }
    expect(changes).toEqual([SLIDE_MIN_MS, 2 * SLIDE_MIN_MS, 3 * SLIDE_MIN_MS]);
    expect(shown.slide).toBe(4);
  });

  it('«Шаг N из 4» — показанный слайд; в самом конце долгой загрузки «Почти готово»', () => {
    expect(slideCaption({ slide: 2, since: 0 }, 0.6, false)).toBe('Шаг 2 из 4');
    expect(slideCaption({ slide: 4, since: 0 }, 0.97, false)).toBe('Почти готово');
    expect(slideCaption({ slide: 4, since: 0 }, 1, true)).toBe('Шаг 4 из 4');
  });

  it('уходим, когда четвёртый слайд показан положенное время', () => {
    const done = run({ finished: true, finishedAt: 10000 });
    expect(canLeave(done, { slide: 3, since: 9000 }, 20000)).toBe(false);
    expect(canLeave(done, { slide: 4, since: 11000 }, 13000)).toBe(false);
    expect(canLeave(done, { slide: 4, since: 11000 }, 11000 + SLIDE_MIN_MS)).toBe(true);
    expect(canLeave(run({ stage: 2 }), { slide: 4, since: 0 }, 99999)).toBe(false);
  });

  it('быстрый экран без слайдов: сразу после конца, но не короче 1.2 с', () => {
    const quick = run({ slides: false, finished: true, finishedAt: 300 });
    expect(canLeave(quick, { slide: 1, since: 0 }, QUICK_MIN_MS - 1)).toBe(false);
    expect(canLeave(quick, { slide: 1, since: 0 }, QUICK_MIN_MS)).toBe(true);
  });
});

describe('СИНТЕТИЧЕСКИЕ: когда показывать слайды', () => {
  it('первый запуск — всегда; иначе только при загрузке от 3 дней', () => {
    expect(wantsSlides(true, 1)).toBe(true);
    expect(wantsSlides(false, 3)).toBe(true);
    expect(wantsSlides(false, 2)).toBe(false);
    expect(wantsSlides(false, 1)).toBe(false);
  });

  it('статус настоящий: «Подключаемся…», потом «Загружаем данные · N %»', () => {
    expect(statusText(run({ stage: 1 }), 0.05)).toBe('Подключаемся…');
    expect(statusText(run({ stage: 2 }), 0.42)).toBe('Загружаем данные · 42 %');
    expect(DEFAULT_SEGMENT_MS.connect).toBeGreaterThan(0);
  });
});

describe('СИНТЕТИЧЕСКИЕ: фоновая догрузка при заполненном кэше', () => {
  it('кэш есть, грузить сегодня (и вчера) — экран загрузки не открываем', () => {
    expect(runsInBackground(false, 1, true)).toBe(true);
    expect(runsInBackground(false, 2, true)).toBe(true);
  });
  it('первый запуск, пустой кэш или неделя целиком — через экран загрузки', () => {
    expect(runsInBackground(true, 7, false)).toBe(false);
    expect(runsInBackground(false, 1, false)).toBe(false);
    expect(runsInBackground(false, 7, true)).toBe(false);
  });
});
