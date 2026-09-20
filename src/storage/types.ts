import type { KnownRing } from '../ble';
import type { RawByDay } from './raw';
import type { ComponentId, ReportMode, SleepStage } from '../domain';

/** Одна точка графика: секунды от начала дня + значение. Так день хранится компактно. */
export interface DayPoint {
  /** Минуты от полуночи (0–1439). */
  m: number;
  v: number;
}

/** Сводка за день. Всё, что нужно экрану; сырые минутные ряды не храним. */
export interface DaySnapshot {
  /** «2026-09-18». */
  date: string;
  total: number | null;
  scores: Record<ComponentId, number | null>;
  steps: number | null;
  sleep: { totalMin: number; deepMin: number; lightMin: number } | null;
  restingHr: number | null;
  /** Откуда взят пульс: ночь (пульс покоя) или минимум за день. */
  restingHrSource: 'night' | 'day' | null;
  /** Какие входы «организма» посчитаны — для объяснения в интерфейсе. */
  stateInputs: { hrv: boolean; restingHr: boolean };
  heart: DayPoint[];
  /** Напряжение (индекс стресса) по времени. */
  stress: DayPoint[];
  /** Точки сводки 0x55 по времени: для графиков давления, глюкозы и вариабельности. */
  summaryPoints: {
    m: number;
    systolic: number | null;
    diastolic: number | null;
    glucose: number | null;
    hrv: number | null;
  }[];
  /** Шаги по часам суток: ровно 24 числа. */
  stepsByHour: number[];
  /** Отрезки гипнограммы. Минуты от полуночи этого дня; вечер накануне — отрицательные. */
  sleepSegments: { from: number; to: number; stage: SleepStage }[];
  /** Оценочные показатели: показываем, но в итог не берём. */
  estimates: {
    hrv: number | null;
    glucose: number | null;
    systolic: number | null;
    diastolic: number | null;
    stress: number | null;
  };
}

export interface StoredReport {
  date: string;
  mode: ReportMode;
  templateId: string;
  text: string;
}

export interface VueloState {
  days: DaySnapshot[];
  reports: StoredReport[];
  lastSyncAt: number | null;
  /** Заряд кольца на момент последней синхронизации. */
  battery: number | null;
  /** Расход за сегодня из пакета 0x03. Кольцо отдаёт только текущий день. */
  caloriesToday: number | null;
  /** Дата, к которой относится этот расход. */
  caloriesDate: string | null;
  /** Опознанное кольцо: по идентификатору подключаемся без поиска в эфире. */
  ring: KnownRing | null;
  /** Возраст для расчёта пульсовых зон; null — не спрашивали. */
  age: number | null;
  /** Полные ряды по дням: из них пересчитываются сводки. */
  raw: RawByDay;
  /** Последняя попытка синхронизации не удалась. */
  syncFailed: boolean;
  /** Профиль: нужен для 0x02 и расчёта пульсовых зон. */
  profile: Profile;
  /** Пользователь нажал «Начать» хотя бы раз: системный запрос Bluetooth уже показывали. */
  started: boolean;
}

export type Sex = 'male' | 'female';
export type Goal = 'lose' | 'gain' | 'keep';

export interface Profile {
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  birthYear: number | null;
  goal: Goal | null;
}

export const EMPTY_PROFILE: Profile = { sex: null, heightCm: null, weightKg: null, birthYear: null, goal: null };

/** Границы полей профиля. */
export const PROFILE_LIMITS = {
  heightCm: { min: 100, max: 230 },
  weightKg: { min: 30, max: 250 },
  age: { min: 10, max: 99 },
} as const;

export const profileAge = (profile: Profile, now = new Date()): number | null =>
  profile.birthYear === null ? null : now.getFullYear() - profile.birthYear;

export const isProfileComplete = (p: Profile): boolean =>
  p.sex !== null && p.heightCm !== null && p.weightKg !== null && p.birthYear !== null;

export const EMPTY_STATE: VueloState = {
  days: [], raw: {}, reports: [], lastSyncAt: null, syncFailed: false, battery: null,
  caloriesToday: null, caloriesDate: null,
  ring: null, age: null, profile: EMPTY_PROFILE, started: false,
};
/** Сколько дней показываем в недельной полосе. Кэш хранит ровно одну последнюю синхронизацию. */
export const HISTORY_DAYS = 7;
