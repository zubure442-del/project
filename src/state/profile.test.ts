import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROFILE, EMPTY_STATE, loadProfile, saveState } from '../storage';
import { bannerKind } from './day';
import { mergeProfile, missingFields, parseProfileNumber, profileAlerts, withStartName } from './profile';

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

describe('СИНТЕТИЧЕСКИЕ: красная точка на «Профиле»', () => {
  const filled = [
    { sex: 'male' as const },
    { heightCm: 187 },
    { weightKg: 75 },
    { birthYear: 1990 },
    { goal: 'keep' as const },
  ].reduce((p, patch) => mergeProfile(p, patch), EMPTY_PROFILE);

  it('после сохранения всех пяти полей нет ни точки, ни плашки, ни красных рамок', () => {
    expect(profileAlerts(filled)).toEqual({ missing: new Set(), dot: false, banner: null });
  });

  it('имя на точку не влияет', () => {
    expect(profileAlerts({ ...filled, name: null }).dot).toBe(false);
  });

  it('пустая цель включает точку и плашку «Цель не выбрана»', () => {
    const alerts = profileAlerts({ ...filled, goal: null });
    expect(alerts.dot).toBe(true);
    expect(alerts.banner).toBe('goal');
  });

  it('очистка данных включает их снова', () => {
    const alerts = profileAlerts(EMPTY_PROFILE);
    expect(alerts.dot).toBe(true);
    expect(alerts.banner).toBe('biometry');
    expect(alerts.missing.size).toBe(5);
  });

  it('правки подряд не затирают друг друга', () => {
    expect(filled).toMatchObject({ sex: 'male', heightCm: 187, weightKg: 75, birthYear: 1990, goal: 'keep' });
  });

  it('«0», пустая строка и неполный год — не значение', () => {
    const now = new Date(2026, 8, 21);
    expect(parseProfileNumber('weightKg', '0', now)).toBeNull();
    expect(parseProfileNumber('heightCm', '', now)).toBeNull();
    expect(parseProfileNumber('birthYear', '199', now)).toBeNull();
    expect(parseProfileNumber('birthYear', '1990', now)).toBe(1990);
    expect(parseProfileNumber('heightCm', '187', now)).toBe(187);
  });
});
