import { describe, expect, it } from 'vitest';
import type { Sample } from '../codec/types';
import {
  allTemplates,
  buildTemplateReport,
  buildSleepSessions,
  cleanHeart,
  computeDayScore,
  nightForDate,
  smoothHeart,
  splitSegments,
  type ScoreInput,
} from './index';

const ring = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') / 1000;
const T0 = ring('2026-09-18 10:00:00');
/** Ряд пульса с шагом 30 минут. */
const series = (values: number[], step = 1800, t0 = T0): Sample[] =>
  values.map((value, i) => ({ ts: t0 + i * step, value }));

describe('СИНТЕТИЧЕСКИЕ: очистка пульса', () => {
  it('одиночный скачок вверх с возвратом — артефакт', () => {
    const { clean, glitches } = cleanHeart(series([70, 72, 130, 71, 73]));
    expect(glitches).toEqual([{ ts: T0 + 3600, value: 130, before: 72, after: 71 }]);
    expect(clean.map((s) => s.value)).toEqual([70, 72, 71, 73]);
  });
  it('два замера подряд — тоже артефакт, три — уже нет', () => {
    expect(cleanHeart(series([70, 120, 125, 72, 71])).glitches).toHaveLength(2);
    expect(cleanHeart(series([70, 120, 125, 118, 72, 71])).glitches).toHaveLength(0);
  });
  it('реальный подъём, который держится, не трогаем', () => {
    const { clean, glitches } = cleanHeart(series([70, 110, 115, 118, 120, 119]));
    expect(glitches).toHaveLength(0);
    expect(clean).toHaveLength(6);
  });
  it('скачок вниз тоже ловится', () => {
    expect(cleanHeart(series([80, 78, 40, 79, 80])).glitches.map((g) => g.value)).toEqual([40]);
  });
  it('большой разрыв по времени — сравнение не проводится', () => {
    expect(cleanHeart(series([70, 130, 71], 3000)).glitches).toHaveLength(0);
  });
  it('последний замер остаётся, вход не меняется', () => {
    const input = series([70, 72, 140]);
    const copy = JSON.stringify(input);
    expect(cleanHeart(input).clean).toHaveLength(3);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('СИНТЕТИЧЕСКИЕ: сглаживание пульса', () => {
  it('скользящая медиана ±45 мин гасит одиночный выброс', () => {
    const smooth = smoothHeart(series([70, 71, 140, 72, 71]));
    expect(smooth[2].value).toBe(72);
  });
  it('линия рвётся при разрыве больше 90 минут', () => {
    const pts = [...series([70, 71]), ...series([80], 1800, T0 + 3 * 3600)];
    expect(splitSegments(pts).map((s) => s.length)).toEqual([2, 1]);
    const near = [...series([70, 71]), ...series([80], 1800, T0 + 5400 + 1800)];
    expect(splitSegments(near).map((s) => s.length)).toEqual([3]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: сон', () => {
  const minutes = (from: string, n: number, state: number): Sample[] =>
    Array.from({ length: n }, (_, i) => ({ ts: ring(from) + i * 60, value: state }));

  it('ночь через полночь — одна сессия, дата по последней минуте', () => {
    const s = buildSleepSessions([...minutes('2026-09-18 23:30:00', 60, 40), ...minutes('2026-09-19 00:30:00', 300, 85)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ date: '2026-09-19', lightMin: 60, deepMin: 300 });
  });
  it('разрыв больше 2 часов начинает новую сессию', () => {
    const s = buildSleepSessions([...minutes('2026-09-19 01:00:00', 60, 40), ...minutes('2026-09-19 04:00:00', 60, 40)]);
    expect(s).toHaveLength(2);
  });
  it('бодрствование не считается сном; сессия без сна отбрасывается', () => {
    const s = buildSleepSessions([...minutes('2026-09-19 01:00:00', 10, 0), ...minutes('2026-09-19 05:00:00', 10, 50)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ lightMin: 10, awakeMin: 0 });
  });
  it('ночь — самая длинная сессия дня, остальное — дневной сон', () => {
    const s = buildSleepSessions([...minutes('2026-09-19 00:00:00', 400, 40), ...minutes('2026-09-19 14:00:00', 30, 40)]);
    const { night, naps } = nightForDate(s, '2026-09-19');
    expect(night?.lightMin).toBe(400);
    expect(naps).toHaveLength(1);
    expect(nightForDate(s, '2026-09-20').night).toBeNull();
  });
});

describe('СИНТЕТИЧЕСКИЕ: итог Vuelo', () => {
  const nightHeart = (n: { start: number; end: number }) =>
    [50, 52, 55, 58].map((value, i) => ({ ts: n.start + i * 1800, value }));

  const night = (light: number, deep: number) => ({
    start: T0 - 8 * 3600, end: T0 - 3600, deepMin: deep, lightMin: light, awakeMin: 0, date: '2026-09-18',
  });
  const base: ScoreInput = { night: null, steps: null, heart: [], age: 30, hrv: [], spo2: [] };

  it('нет никаких данных — итог null, а не 0', () => {
    const r = computeDayScore(base);
    expect(r.total).toBeNull();
    expect(r.sleep).toEqual({ score: null, weight: 0 });
    expect(r.activity.score).toBeNull();
    expect(r.state.score).toBeNull();
  });
  it('по одной или двум составляющим итог не строится никогда', () => {
    const r = computeDayScore({ ...base, night: night(336, 84) }); // 420 мин, 20% глубокого = 100
    expect(r.sleep.score).toBe(100);
    expect(r.total).toBeNull();
    expect(r.activity.weight).toBe(0);
    const two = computeDayScore({ ...base, night: night(336, 84), steps: 10000 });
    expect(two.activity.score).toBe(70);
    expect(two.total).toBeNull();
  });
  it('веса 15/70/15 при полных данных', () => {
    const r = computeDayScore({ ...base, night: night(336, 84), steps: 10000, hrv: [65], heart: nightHeart(night(336, 84)) });
    expect(r.sleep.weight).toBeCloseTo(0.15);
    expect(r.activity.weight).toBeCloseTo(0.7);
    expect(r.state.weight).toBeCloseTo(0.15);
    // сон 100, активность 70 (шаги*0.7), состояние 100 -> 15+49+15
    expect(r.activity.score).toBe(70);
    expect(r.total).toBe(79);
  });
  it('итог растёт по мере шагов в течение дня', () => {
    const full = { ...base, night: night(336, 84), hrv: [65], heart: nightHeart(night(336, 84)) };
    const at = (steps: number) => computeDayScore({ ...full, steps }).total as number;
    expect(at(0)).toBeLessThan(at(3000));
    expect(at(3000)).toBeLessThan(at(9000));
  });
  it('ноль шагов — это оценка 0 (данные есть), а не null', () => {
    expect(computeDayScore({ ...base, steps: 0 }).activity.score).toBe(0);
  });
  it('интенсивный пульс добавляет бонус, время замера учитывается пропорционально', () => {
    const hr = series([160, 160, 160]); // 208-21=187; 160/187=0.86 -> зона 2.0
    const withBonus = computeDayScore({ ...base, steps: 0, heart: hr }).activity.score as number;
    expect(withBonus).toBe(24); // 3 замера * 2 очка * 4
    const dense = computeDayScore({ ...base, steps: 0, heart: series([160, 160, 160], 900) }).activity.score as number;
    expect(dense).toBeLessThan(withBonus);
  });
  it('без возраста бонус не начисляется, но и ничего не ломается', () => {
    expect(computeDayScore({ ...base, steps: 5000, age: null, heart: series([160, 160]) }).activity.score).toBe(35);
  });
  it('организм: среднее вариабельности и пульса во сне', () => {
    const n = night(336, 84);
    // нужны оба входа: только вариабельность или только пульс не считаются
    expect(computeDayScore({ ...base, hrv: [65] }).state.score).toBeNull();
    expect(computeDayScore({ ...base, night: n, heart: nightHeart(n) }).state.score).toBeNull();
    // вариабельность 65 -> 100, пульс во сне 50 -> 100
    expect(computeDayScore({ ...base, night: n, heart: nightHeart(n), hrv: [65] }).state.score).toBe(100);
    // вариабельность 32.5 -> 50, пульс тот же 100 -> среднее 75
    expect(computeDayScore({ ...base, night: n, heart: nightHeart(n), hrv: [32.5] }).state.score).toBe(75);
  });
  it('пульс покоя берётся из окна сна', () => {
    const n = night(336, 84);
    const heart = [50, 52, 55, 58, 90].map((value, i) => ({ ts: n.start + i * 1800, value }));
    expect(computeDayScore({ ...base, night: n, heart }).restingHr).toEqual({ value: 50, source: 'night' });
  });
});

describe('шаблонный отчёт', () => {
  const sc = (sleep: number | null, activity: number | null, state: number | null) => {
    const c = (v: number | null) => ({ score: v, weight: v === null ? 0 : 1 });
    return { total: 50, sleep: c(sleep), activity: c(activity), state: c(state), restingHr: null,
      stateInputs: { spo2: false, hrv: false, restingHr: false } };
  };
  it('фраз хватает на все три времени суток и без повторов', () => {
    const n = Object.keys(allTemplates()).length;
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(60);
  });
  it('днём говорим «пока», без прошедшего времени про вечер', () => {
    const past = /прош[её]л день|день получился|день вышел|был[о]? мало движения|день выдался/i;
    for (const mode of ['morning', 'day'] as const) {
      for (const focus of [null, 30, 60]) {
        const r = buildTemplateReport({
          mode,
          score: sc(focus, focus, focus),
          recentTemplateIds: [],
        });
        expect(r.text).not.toMatch(past);
      }
    }
  });
  it('упор на самую слабую составляющую', () => {
    expect(buildTemplateReport({ mode: 'morning', score: sc(30, 20, 80), recentTemplateIds: [] }).focus).toBe('sleep');
    expect(buildTemplateReport({ mode: 'morning', score: sc(80, 20, 40), recentTemplateIds: [] }).focus).toBe('state');
    expect(buildTemplateReport({ mode: 'evening', score: sc(80, 30, 60), recentTemplateIds: [] }).focus).toBe('activity');
  });
  it('утром активность не учитывается — про ночь', () => {
    expect(buildTemplateReport({ mode: 'morning', score: sc(90, 0, 90), recentTemplateIds: [] }).focus).toBeNull();
  });
  it('нет данных — «недостаточно», без выводов', () => {
    const r = buildTemplateReport({ mode: 'evening', score: sc(null, null, null), recentTemplateIds: [] });
    expect(r.focus).toBeNull();
    expect(r.templateId).toMatch(/^nodata/);
  });
  it('не повторяет недавние советы', () => {
    const first = buildTemplateReport({ mode: 'morning', score: sc(30, null, null), recentTemplateIds: [] });
    const second = buildTemplateReport({ mode: 'morning', score: sc(30, null, null), recentTemplateIds: [first.templateId] });
    expect(second.templateId).not.toBe(first.templateId);
  });
  it('нет медицинских утверждений и обещаний', () => {
    const banned = /диагноз|болезн|лечен|пройд[её]т|гарантир|обязательно улучш|давлени|глюкоз|сахар/i;
    for (const text of Object.values(allTemplates())) expect(text).not.toMatch(banned);
  });
});
