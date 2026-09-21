import { PROFILE_LIMITS, type Profile, type VueloState } from '../storage';

/** Поля, без которых расчёты неточны: биометрия и цель. Имя сюда не входит. */
export type RequiredField = 'sex' | 'heightCm' | 'weightKg' | 'birthYear' | 'goal';
export const BIOMETRY_FIELDS: RequiredField[] = ['sex', 'heightCm', 'weightKg', 'birthYear'];

/** Какие обязательные поля пусты: на «Профиле» они выделены красным. */
export function missingFields(profile: Profile): Set<RequiredField> {
  const all: RequiredField[] = [...BIOMETRY_FIELDS, 'goal'];
  return new Set(all.filter((key) => profile[key] === null));
}

/** Подпись под полем имени — в «Профиле» и на экране первого запуска. */
export const NAME_NOTE = 'Имя хранится только на вашем телефоне. Мы не собираем данные.';

export const isGoalSet = (profile: Profile) => profile.goal !== null;

/**
 * Всё, что на экране зависит от заполненности профиля. Один источник для точки на иконке,
 * плашки и красных рамок. Обязательных полей пять; имя и заряд кольца на точку не влияют.
 */
export function profileAlerts(profile: Profile): {
  missing: Set<RequiredField>;
  dot: boolean;
  banner: 'biometry' | 'goal' | null;
} {
  const missing = missingFields(profile);
  const biometry = BIOMETRY_FIELDS.some((key) => missing.has(key));
  return { missing, dot: missing.size > 0, banner: biometry ? 'biometry' : missing.has('goal') ? 'goal' : null };
}

type NumberField = 'heightCm' | 'weightKg' | 'birthYear';

/** Число из поля ввода: только цифры, в границах PROFILE_LIMITS; иначе null (пустое, «0», мусор). */
export function parseProfileNumber(key: NumberField, text: string, now = new Date()): number | null {
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  const value = Number(digits);
  if (key === 'birthYear') {
    const age = now.getFullYear() - value;
    return age >= PROFILE_LIMITS.age.min && age <= PROFILE_LIMITS.age.max ? value : null;
  }
  const { min, max } = PROFILE_LIMITS[key];
  return value >= min && value <= max ? value : null;
}

/** Правка поверх актуального профиля, а не поверх копии с прошлой отрисовки экрана. */
export const mergeProfile = (current: Profile, patch: Partial<Profile>): Profile => ({ ...current, ...patch });

/** Черновик формы первого запуска: числа — как введённый текст. */
export interface OnboardingDraft {
  name: string;
  sex: Profile['sex'];
  heightCm: string;
  weightKg: string;
  birthYear: string;
  goal: Profile['goal'];
}

export const EMPTY_DRAFT: OnboardingDraft = { name: '', sex: null, heightCm: '', weightKg: '', birthYear: '', goal: null };

/**
 * Профиль из формы первого запуска. Обязательны все шесть полей (имя, пол, рост, вес,
 * год рождения, цель); если хоть одно пустое или вне границ — null, форму не отправляем.
 */
export function onboardingProfile(draft: OnboardingDraft, now = new Date()): Profile | null {
  const name = draft.name.trim();
  const heightCm = parseProfileNumber('heightCm', draft.heightCm, now);
  const weightKg = parseProfileNumber('weightKg', draft.weightKg, now);
  const birthYear = parseProfileNumber('birthYear', draft.birthYear, now);
  if (!name || draft.sex === null || draft.goal === null || heightCm === null || weightKg === null || birthYear === null) {
    return null;
  }
  return { name, sex: draft.sex, heightCm, weightKg, birthYear, goal: draft.goal };
}

/** Форма первого запуска отправлена: профиль целиком и отметка о старте. */
export const withOnboarding = (state: VueloState, profile: Profile): VueloState => ({ ...state, started: true, profile });
