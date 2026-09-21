import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROFILE, EMPTY_STATE, loadProfile, saveState } from '../storage';
import { bannerKind } from './day';
import { missingFields, withStartName } from './profile';

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

describe('СИНТЕТИЧЕСКИЕ: имя из первого запуска', () => {
  it('имя, введённое при первом запуске, сразу видно в «Профиле»', async () => {
    await saveState(withStartName(EMPTY_STATE, '  Аня '));
    expect((await loadProfile()).name).toBe('Аня');
  });

  it('«Пропустить» — поле пустое, без ошибок', async () => {
    await saveState(withStartName(EMPTY_STATE, null));
    const profile = await loadProfile();
    expect(profile.name).toBeNull();
    expect(withStartName(EMPTY_STATE, '   ').profile.name).toBeNull();
  });

  it('первый запуск отмечен, остальной профиль не тронут', () => {
    const state = { ...EMPTY_STATE, profile: { ...EMPTY_PROFILE, heightCm: 180 } };
    const next = withStartName(state, 'Аня');
    expect(next.started).toBe(true);
    expect(next.profile.heightCm).toBe(180);
  });
});

describe('СИНТЕТИЧЕСКИЕ: незаполненный профиль', () => {
  it('пустые биометрия и цель подсвечиваются, имя — нет', () => {
    expect([...missingFields(EMPTY_PROFILE)]).toEqual(['sex', 'heightCm', 'weightKg', 'birthYear', 'goal']);
    const full = { ...EMPTY_PROFILE, sex: 'male' as const, heightCm: 180, weightKg: 80, birthYear: 1990, goal: 'keep' as const };
    expect(missingFields(full).size).toBe(0);
    expect([...missingFields({ ...full, goal: null })]).toEqual(['goal']);
  });

  it('плашка: сначала биометрия, потом цель', () => {
    const base = { syncFailed: false, todayLocked: false, shownDate: 'x', today: 'x' };
    expect(bannerKind({ ...base, profileReady: false, goalReady: false })).toBe('biometry');
    expect(bannerKind({ ...base, profileReady: true, goalReady: false })).toBe('goal');
    expect(bannerKind({ ...base, profileReady: true, goalReady: true })).toBeNull();
  });
});
