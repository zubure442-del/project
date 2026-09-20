import type { KnownRing } from '../ble';
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
  stateInputs: { spo2: boolean; hrv: boolean; restingHr: boolean };
  heart: DayPoint[];
  spo2: DayPoint[];
  /** Напряжение (индекс стресса) по времени. */
  stress: DayPoint[];
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
  /** Опознанное кольцо: по идентификатору подключаемся без поиска в эфире. */
  ring: KnownRing | null;
  /** Возраст для расчёта пульсовых зон; null — не спрашивали. */
  age: number | null;
  /** Данные выдуманы для показа интерфейса. На диск такое состояние не пишется. */
  demo: boolean;
}

export const EMPTY_STATE: VueloState = { days: [], reports: [], lastSyncAt: null, battery: null, ring: null, age: null, demo: false };
export const HISTORY_DAYS = 7;
