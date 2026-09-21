import { describe, expect, it } from 'vitest';
import { emptySyncResult } from '../ble/sync';
import { visibleDays } from '../domain/week';
import { EMPTY_STATE, type DaySnapshot, type VueloState } from '../storage';
import { HERO_HINTS, adviceFor, adviceLabel, bannerKind, dayPhrase, dayView, heroHint, missingInputs, selectedDay, shortDate, todayTabLabel } from './day';
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

describe('СИНТЕТИЧЕСКИЕ: сегодня заблокирован, пока неполный', () => {
  it('сегодня неполный — замок, по умолчанию последний полный день (вчера)', () => {
    const view = dayView([day(YESTERDAY, true), day(TODAY, false)], NOON);
    expect(view.todayLocked).toBe(true);
    expect(view.defaultDate).toBe(YESTERDAY);
    expect(view.lastComplete).toBe(YESTERDAY);
  });

  it('как только сегодня полный — замка нет и открывается сегодня', () => {
    const view = dayView([day(YESTERDAY, true), day(TODAY, true)], NOON);
    expect(view.todayLocked).toBe(false);
    expect(view.defaultDate).toBe(TODAY);
  });

  it('полных дней ещё нет вовсе — сегодня не блокируем, на нём «Данные собираются»', () => {
    const view = dayView([day(YESTERDAY, false), day(TODAY, false)], NOON);
    expect(view.todayLocked).toBe(false);
    expect(view.defaultDate).toBe(TODAY);
  });

  it('до четырёх утра открываем вчерашние сутки', () => {
    const view = dayView([day(YESTERDAY, true), day(TODAY, true)], new Date(2026, 8, 21, 2, 30));
    expect(view.defaultDate).toBe(YESTERDAY);
  });

  it('замок виден в неделе, даже если за сегодня совсем пусто', () => {
    const week = [
      { date: YESTERDAY, day: day(YESTERDAY, true) },
      { date: TODAY, day: null },
    ];
    expect(visibleDays(week).map((w) => w.date)).toEqual([YESTERDAY]);
    expect(visibleDays(week, TODAY).map((w) => w.date)).toEqual([YESTERDAY, TODAY]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: одна плашка по приоритету', () => {
  const base = { syncFailed: false, profileReady: true, todayLocked: true, shownDate: YESTERDAY, today: TODAY };
  it('ошибка синхронизации важнее всего', () => {
    expect(bannerKind({ ...base, syncFailed: true, profileReady: false })).toBe('sync-failed');
  });
  it('потом биометрия', () => {
    expect(bannerKind({ ...base, profileReady: false })).toBe('biometry');
  });
  it('потом «показан вчерашний день»', () => {
    expect(bannerKind(base)).toBe('today-locked');
    expect(dayPhrase(YESTERDAY, { yesterday: YESTERDAY })).toBe('вчерашний день');
    expect(dayPhrase('2026-09-18', { yesterday: YESTERDAY })).toBe('18 сентября');
  });
  it('если сегодня полный — плашки нет', () => {
    expect(bannerKind({ ...base, todayLocked: false, shownDate: TODAY })).toBeNull();
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

  it('без выбора — последний полный день', () => {
    expect(selectedDay(null, view, week, 1)).toBe(YESTERDAY);
  });
  it('выбранный в календаре день действует до следующей синхронизации', () => {
    expect(selectedDay({ date: '2026-09-18', key: 1 }, view, week, 1)).toBe('2026-09-18');
    expect(selectedDay({ date: '2026-09-18', key: 1 }, view, week, 2)).toBe(YESTERDAY);
  });
  it('неполный сегодня выбрать нельзя', () => {
    expect(selectedDay({ date: TODAY, key: 1 }, view, week, 1)).toBe(YESTERDAY);
  });
  it('подпись центральной вкладки: «Сегодня» или дата', () => {
    expect(shortDate('2026-09-21')).toBe('21 сен');
    expect(todayTabLabel(TODAY, TODAY)).toBe('Сегодня');
    expect(todayTabLabel(YESTERDAY, TODAY)).toBe('20 сен');
  });
});

describe('СИНТЕТИЧЕСКИЕ: «Данные собираются» вместо числа', () => {
  it('сегодня — что сделать; прошлый день — без обещаний', () => {
    expect(heroHint('sleep', TODAY, TODAY)).toBe(HERO_HINTS.sleepToday);
    expect(heroHint('activity', TODAY, TODAY)).toBe(HERO_HINTS.wearToday);
    expect(heroHint('state', TODAY, TODAY)).toBe(HERO_HINTS.wearToday);
    expect(heroHint('sleep', YESTERDAY, TODAY)).toBe('Нет данных за этот день.');
  });

  it('в «i» — чего именно не хватает', () => {
    const incomplete = day(TODAY, false);
    expect(missingInputs('state', incomplete)).toEqual(['вариабельность', 'пульс во сне', 'кислород']);
    expect(missingInputs('total', incomplete)).toEqual(['организм']);
    expect(missingInputs('sleep', null)).toEqual(['сон за ночь']);
    expect(missingInputs('activity', { ...incomplete, steps: null })).toEqual(['шаги']);
  });
});
