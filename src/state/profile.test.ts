import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROFILE, EMPTY_STATE, loadProfile, saveState } from '../storage';
import { bannerKind } from './day';
import { EMPTY_DRAFT, mergeProfile, missingFields, onboardingProfile, parseProfileNumber, profileAlerts, withOnboarding } from './profile';

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

describe('СИНТЕТИЧЕСКИЕ: форма первого запуска', () => {
  const NOW = new Date(2026, 8, 22);
  const full = { name: ' Аня ', sex: 'female' as const, heightCm: '165', weightKg: '60', birthYear: '1996', goal: 'keep' as const };

  it('все шесть полей заполнены — профиль целиком, имя без пробелов', () => {
    expect(onboardingProfile(full, NOW)).toEqual({ name: 'Аня', sex: 'female', heightCm: 165, weightKg: 60, birthYear: 1996, goal: 'keep' });
  });

  it('любое пустое или неверное поле — форма не отправляется, «Пропустить» нет', () => {
    for (const patch of [{ name: '  ' }, { sex: null }, { goal: null }, { heightCm: '' }, { weightKg: '0' }, { birthYear: '199' }]) {
      expect(onboardingProfile({ ...full, ...patch }, NOW)).toBeNull();
    }
    expect(onboardingProfile(EMPTY_DRAFT, NOW)).toBeNull();
  });

  it('после отправки имя и профиль сразу видны в «Профиле», точки нет', async () => {
    await saveState(withOnboarding(EMPTY_STATE, onboardingProfile(full, NOW) as NonNullable<ReturnType<typeof onboardingProfile>>));
    const profile = await loadProfile();
    expect(profile.name).toBe('Аня');
    expect(profileAlerts(profile).dot).toBe(false);
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
