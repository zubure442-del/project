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

/**
 * Первый запуск: «Продолжить» с именем или «Пропустить» (null). Имя обрезаем;
 * пустое — то же, что пропуск: поле в «Профиле» остаётся пустым.
 */
export function withStartName(state: VueloState, name: string | null): VueloState {
  const trimmed = name?.trim() || null;
  return { ...state, started: true, profile: { ...state.profile, name: trimmed } };
}
