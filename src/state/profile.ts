import type { Profile, VueloState } from '../storage';

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
 * Первый запуск: «Продолжить» с именем или «Пропустить» (null). Имя обрезаем;
 * пустое — то же, что пропуск: поле в «Профиле» остаётся пустым.
 */
export function withStartName(state: VueloState, name: string | null): VueloState {
  const trimmed = name?.trim() || null;
  return { ...state, started: true, profile: { ...state.profile, name: trimmed } };
}
