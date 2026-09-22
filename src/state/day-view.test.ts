import { describe, expect, it } from 'vitest';
import { emptySyncResult } from '../ble/sync';
import { EMPTY_STATE, type DaySnapshot, type VueloState } from '../storage';
import { adviceFor, adviceLabel, bannerKind, coffeeInput, dayPhrase, dayView, recommendationsFor, selectedDay, shortDate, tabAvailable, todayTabLabel } from './day';
import { applySyncResult } from './sync-plan';

const NOON = new Date(2026, 8, 21, 13, 0);
const TODAY = '2026-09-21';
const YESTERDAY = '2026-09-20';

/** Сводка дня: полная — с итогом, неполная — без организма и без итога. */
const day = (date: string, complete: boolean): DaySnapshot => ({
  date,
  total: complete ? 70 : null,
  scores: { sleep: 80, activity: 60, state: complete ? 90 : null },
  steps: 4000,
  sleep: { totalMin: 420, deepMin: 90, lightMin: 330 },
  restingHr: null,
  restingHrSource: null,
  stateInputs: { hrv: complete, restingHr: complete, spo2: false },
  heart: [],
  spo2: [],
  stress: [],
  summaryPoints: [],
  stepsByHour: new Array(24).fill(0),
  stepsByMinute: [],
  sleepSegments: [],
  estimates: { hrv: null, glucose: null, systolic: null, diastolic: null, stress: null },
});

const state = (days: DaySnapshot[]): VueloState => ({ ...EMPTY_STATE, started: true, days });

describe('СИНТЕТИЧЕСКИЕ: экран калибровки вместо переброса на вчера', () => {
  it('по умолчанию открыт сегодняшний день, даже если он неполный', () => {
    const view = dayView([day(YESTERDAY, true), day(TODAY, false)], NOON);
    expect(view.defaultDate).toBe(TODAY);
    expect(view.lastComplete).toBe(YESTERDAY);
  });

  it('данных нет вовсе — всё равно сегодня, без поиска «последнего дня с данными»', () => {
    expect(dayView([], NOON).defaultDate).toBe(TODAY);
  });

  it('ночью тоже открывается сегодняшняя дата, а не вчерашние сутки', () => {
    expect(dayView([day(YESTERDAY, true), day(TODAY, true)], new Date(2026, 8, 21, 2, 30)).defaultDate).toBe(TODAY);
    expect(dayView([day(YESTERDAY, true)], new Date(2026, 8, 21, 0, 5)).defaultDate).toBe(TODAY);
  });

  it('для неполного дня Сон, Активность и Организм закрыты, «Сегодня» и «Профиль» открыты', () => {
    for (const route of ['sleep', 'activity', 'body']) {
      expect(tabAvailable(route, false)).toBe(false);
      expect(tabAvailable(route, true)).toBe(true);
    }
    expect(tabAvailable('index', false)).toBe(true);
    expect(tabAvailable('profile', false)).toBe(true);
  });
});

describe('СИНТЕТИЧЕСКИЕ: одна плашка по приоритету', () => {
  const base = { syncFailed: false, profileReady: true };
  it('ошибка синхронизации важнее всего', () => {
    expect(bannerKind({ ...base, syncFailed: true, profileReady: false })).toBe('sync-failed');
  });
  it('потом биометрия', () => {
    expect(bannerKind({ ...base, profileReady: false })).toBe('biometry');
  });
  it('плашки «показан вчерашний день» больше нет', () => {
    expect(bannerKind(base)).toBeNull();
    expect(dayPhrase('2026-09-18', { yesterday: YESTERDAY })).toBe('18 сентября');
  });
});

describe('СИНТЕТИЧЕСКИЕ: совет только для полного дня', () => {
  it('по неполному дню совета нет', () => {
    expect(adviceFor(state([day(TODAY, false)]), TODAY, NOON)).toBeNull();
  });

  it('пока сегодня неполный, совет за вчера сохраняется и подписан «Совет · вчера»', () => {
    const next = applySyncResult(state([]), emptySyncResult(), null, NOON);
    // Пустая выгрузка: полных дней нет — и советов нет.
    expect(next.reports).toEqual([]);
    const withDays = { ...state([day(YESTERDAY, true), day(TODAY, false)]) };
    const advice = adviceFor(withDays, YESTERDAY, NOON);
    expect(advice?.text).toBeTruthy();
    expect(adviceLabel(YESTERDAY, NOON)).toBe('Совет · вчера');
    expect(adviceLabel(TODAY, NOON)).toBe('Совет');
    expect(adviceLabel('2026-09-18', NOON)).toBe('Совет · 18 сентября');
  });

  it('выданный совет берётся из истории: текст не меняется при перезапуске', () => {
    const s = {
      ...state([day(YESTERDAY, true)]),
      reports: [{ date: YESTERDAY, mode: 'evening' as const, templateId: 'x', text: 'Сохранённый текст' }],
    };
    expect(adviceFor(s, YESTERDAY, NOON)?.text).toBe('Сохранённый текст');
  });
});

describe('СИНТЕТИЧЕСКИЕ: календарь — один выбранный день на все вкладки', () => {
  const view = dayView([day(YESTERDAY, true), day(TODAY, false)], NOON);
  const week = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', YESTERDAY, TODAY];

  it('без выбора — сегодня', () => {
    expect(selectedDay(null, view, week, 1)).toBe(TODAY);
  });
  it('выбранный в календаре день действует до следующей синхронизации', () => {
    expect(selectedDay({ date: '2026-09-18', key: 1 }, view, week, 1)).toBe('2026-09-18');
    expect(selectedDay({ date: '2026-09-18', key: 1 }, view, week, 2)).toBe(TODAY);
  });
  it('любой день недели выбирается, в том числе неполный сегодня', () => {
    expect(selectedDay({ date: TODAY, key: 1 }, view, week, 1)).toBe(TODAY);
    expect(selectedDay({ date: '2026-09-01', key: 1 }, view, week, 1)).toBe(TODAY);
  });
  it('подпись центральной вкладки: «Сегодня» или дата', () => {
    expect(shortDate('2026-09-21')).toBe('21 сен');
    expect(todayTabLabel(TODAY, TODAY)).toBe('Сегодня');
    expect(todayTabLabel(YESTERDAY, TODAY)).toBe('20 сен');
  });
});

describe('СИНТЕТИЧЕСКИЕ: данные для «Кофейного окна»', () => {
  const withNight = (date: string, from: number, to: number, sleepScore: number | null = 80): DaySnapshot => ({
    ...day(date, true),
    scores: { sleep: sleepScore, activity: 60, state: 90 },
    sleepSegments: [{ from, to: from + 60, stage: 'light' }, { from: from + 60, to, stage: 'deep' }],
  });

  it('ночь — сегодняшняя; отход ко сну — по прошлым ночам в минутах сегодняшнего дня', () => {
    const input = coffeeInput([withNight(YESTERDAY, -30, 400), withNight(TODAY, -60, 420)], NOON);
    expect(input).toMatchObject({ wakeMinute: 420, sleepScore: 80, bedtimes: [1410, 1380], nowMinute: 13 * 60 });
  });

  it('оценки сна за сегодня нет — данных нет вовсе, вчерашняя ночь не подставляется', () => {
    expect(coffeeInput([withNight(YESTERDAY, -30, 400), { ...day(TODAY, true), sleep: null }], NOON)).toBeNull();
    expect(coffeeInput([withNight(YESTERDAY, -30, 400), withNight(TODAY, -60, 420, null)], NOON)).toBeNull();
    expect(coffeeInput([], NOON)).toBeNull();
  });

  it('карточка на сегодня: скрыта без оценки сна, есть при низкой, средней и высокой — с верным N', () => {
    const noSleep = recommendationsFor(state([withNight(TODAY, -60, 420, null)]), TODAY, NOON);
    expect(noSleep?.coffee).toBeNull();
    expect(noSleep?.slides).not.toContain('coffee');
    for (const [score, n] of [[40, 1], [75, 2], [95, 3]] as const) {
      const recs = recommendationsFor(state([withNight(TODAY, -60, 420, score)]), TODAY, NOON);
      expect(recs?.slides).toContain('coffee');
      expect(recs?.coffee).toMatchObject({ kind: 'window', cups: { n } });
    }
  });
});

describe('СИНТЕТИЧЕСКИЕ: на прошлых днях рекомендаций нет', () => {
  const full = (date: string): DaySnapshot => ({
    ...day(date, true),
    sleepSegments: [{ from: -60, to: 420, stage: 'light' }],
  });
  const s = state([full('2026-09-18'), full(YESTERDAY), full(TODAY)]);

  it('сегодня — совет, кофейное окно и карточки «Скоро»; «Эстафета» живёт отдельно', () => {
    const recs = recommendationsFor(s, TODAY, NOON);
    expect(recs?.advice?.text).toBeTruthy();
    expect(recs?.coffee).not.toBeNull();
    expect(recs?.slides).toEqual(['advice', 'coffee', 'food', 'endurance', 'sleepmode']);
  });

  it('любой прошлый день — весь рекомендательный слой скрыт, хотя день полный и сон есть', () => {
    for (const date of [YESTERDAY, '2026-09-18', '2026-09-15']) {
      expect(recommendationsFor(s, date, NOON)).toBeNull();
    }
  });

  it('данные прошлого дня при этом на месте: итог и три метрики', () => {
    const past = s.days.find((d) => d.date === YESTERDAY);
    expect(past?.total).not.toBeNull();
    expect(past?.scores).toEqual({ sleep: 80, activity: 60, state: 90 });
  });
});
