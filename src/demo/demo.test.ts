import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dateKey } from '../codec/time';
import {
  activityScore,
  buildSleepSessions,
  cleanHeart,
  nightForDate,
  sleepScore,
  wakeMinuteOf,
  WEIGHTS,
} from '../domain';
import { EMPTY_STATE, SNAPSHOT_DAYS, loadState, profileAge, saveState, toSyncResult, type Profile, type VueloState } from '../storage';
import { DEMO_STATUS_TEXT, demoState } from '../state/demo';
import { applySyncResult, rebuildDays } from '../state/sync-plan';
import { DEMO, generateDemoRaw } from './generate';

/** Хранилище телефона в памяти: как AsyncStorage, только без устройства. */
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));
beforeEach(() => disk.clear());

const NOON = new Date(2026, 8, 22, 13, 10);
const TODAY = '2026-09-22';
const YESTERDAY = '2026-09-21';
const PROFILE: Profile = { name: 'Аня', sex: 'female', heightCm: 168, weightKg: 60, birthYear: 1994, goal: 'keep' };
const REAL: VueloState = { ...EMPTY_STATE, started: true, profile: PROFILE, lastSyncAt: NOON.getTime() - 3600_000 };
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

describe('СИНТЕТИЧЕСКИЕ: демо-генератор выдаёт только второстепенные показатели', () => {
  const raw = generateDemoRaw(1, NOON);

  it('ряды того же вида, что после выгрузки кольца, — без оценок', () => {
    expect(Object.keys(raw)).toHaveLength(DEMO.historyDays);
    for (const day of Object.values(raw)) {
      expect(Object.keys(day).sort()).toEqual(['date', 'heart', 'sleep', 'spo2', 'steps', 'summary']);
      expect(day.steps.length && day.sleep.length && day.heart.length && day.summary.length && day.spo2.length).toBeTruthy();
    }
  });

  it('сегодня — только до текущей минуты', () => {
    const nowMinute = 13 * 60 + 10;
    const today = raw[TODAY];
    for (const series of [today.steps, today.sleep, today.heart, today.summary, today.spo2]) {
      expect(Math.max(...series.map((p) => p[0]))).toBeLessThanOrEqual(nowMinute);
    }
  });

  it('одно зерно — одни данные; другое зерно — другая неделя', () => {
    expect(generateDemoRaw(1, NOON)).toEqual(raw);
    expect(generateDemoRaw(2, NOON)).not.toEqual(raw);
  });

  it('правдоподобно: пульс, кислород, давление, сон и шаги в разумных пределах, выбросов нет', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = generateDemoRaw(seed, NOON);
      const sync = toSyncResult(r);
      // Фильтр артефактов ничего не выбрасывает: пульс меняется плавно, тренировка не похожа на сбой.
      expect(cleanHeart(sync.heart).glitches).toEqual([]);
      const within = (value: number, from: number, to: number) => expect(value >= from && value <= to, `${value} вне ${from}–${to}`).toBe(true);
      for (const s of sync.heart) within(s.value, 40, 160);
      for (const s of sync.spo2) within(s.value, 90, 100);
      for (const x of sync.summary) {
        within(x.systolic! - x.diastolic!, 30, 60);
        within(x.glucose!, 4, 6.5);
      }
      for (const date of Object.keys(r).filter((d) => d !== TODAY)) {
        within(r[date].steps.reduce((sum, [, v]) => sum + v, 0), 3000, 16000);
        within(r[date].sleep.filter(([, v]) => v > 0).length, 4 * 60, 8.5 * 60);
      }
    }
  });
});

describe('СИНТЕТИЧЕСКИЕ: демо — те же формулы, что и для кольца', () => {
  const seed = 7;
  const shown = demoState(REAL, seed, NOON);
  const raw = generateDemoRaw(seed, NOON);
  const day = (date: string) => shown.days.find((d) => d.date === date)!;

  it('две недели сводок, прошлые дни — полные (все три метрики и итог)', () => {
    expect(shown.days.map((d) => d.date)).toEqual(
      Array.from({ length: SNAPSHOT_DAYS }, (_, i) => shift(TODAY, i - (SNAPSHOT_DAYS - 1))),
    );
    for (const d of shown.days.filter((x) => x.date !== TODAY)) {
      expect(d.scores.sleep).not.toBeNull();
      expect(d.scores.activity).not.toBeNull();
      expect(d.scores.state).not.toBeNull();
      expect(d.total).not.toBeNull();
    }
  });

  it('итог = сон 15 % + активность 70 % + организм 15 % (с точностью до округления)', () => {
    for (const d of shown.days.filter((x) => x.total !== null)) {
      const weighted = (WEIGHTS.sleep * d.scores.sleep! + WEIGHTS.activity * d.scores.activity! + WEIGHTS.state * d.scores.state!) / 100;
      expect(Math.abs(d.total! - weighted)).toBeLessThanOrEqual(1);
    }
  });

  it('Сон пересчитывается вручную из минутных фаз: длительность, глубина, подъём, бонус', () => {
    const sessions = buildSleepSessions(toSyncResult(raw).sleep);
    const { night } = nightForDate(sessions, YESTERDAY);
    const previousWakes = Array.from({ length: 7 }, (_, i) => nightForDate(sessions, shift(YESTERDAY, -(i + 1))).night)
      .filter((n) => n !== null)
      .map((n) => wakeMinuteOf(n!));
    const expected = sleepScore(night, { previousWakes, yesterdayActivity: day(shift(YESTERDAY, -1)).scores.activity });
    expect(day(YESTERDAY).scores.sleep).toBe(Math.round(expected!));
    expect(day(YESTERDAY).sleep?.totalMin).toBe(raw[YESTERDAY].sleep.filter(([, v]) => v > 0).length);
  });

  it('Активность пересчитывается вручную из шагов, пульса и нормы дня', () => {
    const clean = cleanHeart(toSyncResult(raw).heart).clean.filter((s) => dateKey(s.ts) === YESTERDAY);
    const age = profileAge(PROFILE, NOON);
    const d = day(YESTERDAY);
    expect(d.scores.activity).toBe(Math.round(activityScore(d.steps, clean, age, d.stepNorm!.value)!));
  });

  it('Организм следует за входами: хуже кислород — ниже оценка, выше вариабельность — выше', () => {
    const base = day(YESTERDAY).scores.state!;
    const lowOxygen = { ...raw, [YESTERDAY]: { ...raw[YESTERDAY], spo2: raw[YESTERDAY].spo2.map(([m]) => [m, 89] as [number, number]) } };
    const highHrv = {
      ...raw,
      [YESTERDAY]: { ...raw[YESTERDAY], summary: raw[YESTERDAY].summary.map(([m, a, b, c, d, hrv]) => [m, a, b, c, d, hrv + 15] as typeof raw[string]['summary'][number]) },
    };
    const organism = (r: typeof raw) =>
      rebuildDays({ ...REAL, raw: r }, NOON).days.find((d) => d.date === YESTERDAY)!.scores.state!;
    expect(organism(lowOxygen)).toBeLessThan(base);
    expect(organism(highHrv)).toBeGreaterThan(base);
  });

  it('демо-ряды, пропущенные путём кольца (applySyncResult), дают те же оценки', () => {
    const viaRing = applySyncResult(REAL, toSyncResult(raw), null, NOON);
    const pick = (s: VueloState) => s.days.map((d) => ({ date: d.date, total: d.total, scores: d.scores, steps: d.steps }));
    expect(pick(viaRing)).toEqual(pick(shown));
  });

  it('без биометрии демо тоже считается: калорий нет, оценки есть', () => {
    const noProfile = demoState({ ...REAL, profile: { ...PROFILE, birthYear: null } }, seed, NOON);
    expect(noProfile.days.find((d) => d.date === YESTERDAY)?.calories).toBeNull();
    expect(noProfile.days.find((d) => d.date === YESTERDAY)?.total).not.toBeNull();
  });
});

describe('СИНТЕТИЧЕСКИЕ: демо не попадает в реальное хранилище', () => {
  /** Настоящее состояние: один день с парой шагов и заряд. */
  const real: VueloState = {
    ...REAL,
    battery: 64,
    raw: { [YESTERDAY]: { date: YESTERDAY, steps: [[600, 40]], sleep: [], heart: [[600, 72]], summary: [], spo2: [] } },
  };
  const withDays = rebuildDays(real, NOON);

  it('демо помечено и `saveState` его не пишет', async () => {
    await saveState(withDays);
    const before = disk.get('vuelo/state/v1');
    const shown = demoState(withDays, 3, NOON);
    expect(shown.demo).toBe(true);
    await saveState(shown);
    expect(disk.get('vuelo/state/v1')).toBe(before);
  });

  it('настоящее состояние не меняется: ряды, нормы, советы, отметки выгрузки', () => {
    const snapshot = JSON.stringify(withDays);
    const shown = demoState(withDays, 3, NOON);
    expect(JSON.stringify(withDays)).toBe(snapshot);
    expect(shown.raw).not.toBe(withDays.raw);
    expect(withDays.demo).toBeUndefined();
  });

  it('после выключения из хранилища читаются настоящие данные без следов демо', async () => {
    await saveState(withDays);
    await saveState(demoState(withDays, 3, NOON));
    const loaded = await loadState();
    expect(loaded.raw).toEqual(withDays.raw);
    expect(loaded.days).toEqual(withDays.days);
    expect(loaded.battery).toBe(64);
    expect(JSON.stringify(loaded)).not.toContain('"demo"');
  });

  it('статус в шапке в демо — «Демо-режим»', () => {
    expect(DEMO_STATUS_TEXT).toBe('Демо-режим');
  });
});
