import type { AutoMeasurePeriod } from '../codec';
import type { KnownRing } from '../ble';
import type { RawByDay } from './raw';
import type { ComponentId, ReportMode, SleepStage, StoredNorm } from '../domain';

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
  stateInputs: { hrv: boolean; restingHr: boolean; spo2: boolean };
  heart: DayPoint[];
  /** Кислород за день: редкие одиночные замеры. */
  spo2: DayPoint[];
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
  /** Активные ккал за день по нашей минутной модели; null — нет биометрии. У старых сводок поля нет. */
  calories?: number | null;
  /** Норма шагов дня. У старых сводок из кэша её может не быть — тогда 10 000. */
  stepNorm?: StoredNorm;
  /** Шаги по часам суток: ровно 24 числа. */
  stepsByHour: number[];
  /** Шаги по минутам: нужны, чтобы находить эпизоды нагрузки. */
  stepsByMinute: DayPoint[];
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
  /** Опознанное кольцо: по идентификатору подключаемся без поиска в эфире. */
  ring: KnownRing | null;
  /** Возраст для расчёта пульсовых зон; null — не спрашивали. */
  age: number | null;
  /** Полные ряды по дням: из них пересчитываются сводки. */
  raw: RawByDay;
  /** Последняя попытка синхронизации закончилась ошибкой связи: висит плашка «Повторить». */
  syncFailed: boolean;
  /**
   * Когда день последний раз выгружен целиком (все потоки закрыты маркером) в удачной синхронизации.
   * По этому времени решаем, финальный ли день и нужно ли его запрашивать снова.
   */
  syncedAt: Record<string, number>;
  /** Норма шагов по дням: считается один раз в день и дальше не меняется. */
  stepNorms: Record<string, StoredNorm>;
  /** Длительности частей последних удачных загрузок, мс (подключение, запросы по видам): для равномерного процента. */
  requestDurations: Record<string, number[]>;
  /** Профиль: нужен для 0x02 и расчёта пульсовых зон. */
  profile: Profile;
  /** Частота автозамеров кольца, минуты: уходит в байт 6 команды 0x19. */
  autoMeasureMin: AutoMeasurePeriod;
  /** Когда получен заряд. */
  batteryAt: number | null;
  /** Пользователь нажал «Начать» хотя бы раз: системный запрос Bluetooth уже показывали. */
  started: boolean;
}

export type Sex = 'male' | 'female';
export type Goal = 'lose' | 'gain' | 'keep';

export interface Profile {
  /** Как обращаться. Необязательное, хранится только на телефоне. */
  name: string | null;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  birthYear: number | null;
  goal: Goal | null;
}

export const EMPTY_PROFILE: Profile = { name: null, sex: null, heightCm: null, weightKg: null, birthYear: null, goal: null };

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
  days: [], raw: {}, reports: [], lastSyncAt: null, syncFailed: false, syncedAt: {}, stepNorms: {}, requestDurations: {}, battery: null,
  ring: null, age: null, profile: EMPTY_PROFILE, autoMeasureMin: 30, batteryAt: null, started: false,
};
/** Сколько дней показываем в недельном графике. */
export const HISTORY_DAYS = 7;
/** Сколько дней держим в кэше; лишнее удаляется при запуске. */
export const CACHE_DAYS = 30;
