import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySyncResult } from '../ble/sync';
import { generateDemoRaw } from '../demo/generate';
import { EMPTY_STATE, loadState, type Profile, type VueloState } from '../storage';
import { applySyncResult, newUserTodayOnly, planDays, rebuildDays } from './sync-plan';

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
const PROFILE: Profile = { name: null, sex: 'male', heightCm: 180, weightKg: 75, birthYear: 1990, goal: 'keep' };
const WEEK = [0, 1, 2, 3, 4, 5, 6];

/** Кольцо только надели: за сегодня есть шаги, но ни сна, ни замеров — полного дня нет. */
const firstDay = (): VueloState['raw'] => ({
  '2026-09-22': { date: '2026-09-22', steps: [[600, 80], [601, 90]], sleep: [], heart: [], summary: [], spo2: [] },
});

describe('СИНТЕТИЧЕСКИЕ: кэш нового пользователя', () => {
  it('самая первая загрузка — неделя целиком', () => {
    const state = { ...EMPTY_STATE, started: true };
    expect(newUserTodayOnly(state)).toBe(false);
    expect(planDays(state.syncedAt, NOON, { todayOnly: newUserTodayOnly(state) }).days).toEqual(WEEK);
  });

  it('повторные загрузки без полного дня — только сегодня', () => {
    const after = applySyncResult({ ...EMPTY_STATE, started: true, profile: PROFILE }, emptySyncResult(), null, NOON);
    const state = rebuildDays({ ...after, raw: firstDay() }, NOON);
    expect(state.hadCompleteDay).toBe(false);
    expect(newUserTodayOnly(state)).toBe(true);
    const plan = planDays({}, NOON, { todayOnly: newUserTodayOnly(state) });
    expect(plan.days).toEqual([0]);
    expect(plan.note).toContain('новый пользователь');
  });

  it('после первого полного дня — обычная логика', () => {
    const before = { ...EMPTY_STATE, started: true, profile: PROFILE, lastSyncAt: NOON.getTime() - 3600_000 };
    const state = rebuildDays({ ...before, raw: generateDemoRaw(7, NOON) }, NOON);
    expect(state.days.some((d) => d.total !== null)).toBe(true);
    expect(state.hadCompleteDay).toBe(true);
    expect(newUserTodayOnly(state)).toBe(false);
    expect(planDays({}, NOON, { todayOnly: newUserTodayOnly(state) }).days).toEqual(WEEK);
  });

  it('флаг не гаснет, когда полный день ушёл из недели', () => {
    const state = rebuildDays({ ...EMPTY_STATE, hadCompleteDay: true, lastSyncAt: 1, raw: firstDay() }, NOON);
    expect(state.days.some((d) => d.total !== null)).toBe(false);
    expect(newUserTodayOnly(state)).toBe(false);
  });

  it('старый кэш без флага: полный день в сводках — пользователь не новый', async () => {
    const full = rebuildDays({ ...EMPTY_STATE, profile: PROFILE, raw: generateDemoRaw(7, NOON) }, NOON);
    const { hadCompleteDay: _drop, ...old } = { ...full, started: true, lastSyncAt: 1 };
    void _drop;
    disk.set('vuelo/state/v1', JSON.stringify(old));
    expect((await loadState()).hadCompleteDay).toBe(true);

    const empty = { ...EMPTY_STATE, started: true, lastSyncAt: 1 } as Partial<VueloState>;
    delete empty.hadCompleteDay;
    disk.set('vuelo/state/v1', JSON.stringify(empty));
    expect((await loadState()).hadCompleteDay).toBe(false);
  });
});
