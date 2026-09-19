import type { ComponentId } from '../domain';

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
  heart: DayPoint[];
  spo2: DayPoint[];
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
  mode: 'morning' | 'evening';
  templateId: string;
  text: string;
}

export interface VueloState {
  days: DaySnapshot[];
  reports: StoredReport[];
  lastSyncAt: number | null;
  /** Возраст для расчёта пульсовых зон; null — не спрашивали. */
  age: number | null;
  /** Данные выдуманы для показа интерфейса. Любая настоящая синхронизация снимает флаг. */
  demo: boolean;
  /** Пользователь убрал демо-данные — больше не подставлять их сами. */
  demoDismissed: boolean;
}

export const EMPTY_STATE: VueloState = { days: [], reports: [], lastSyncAt: null, age: null, demo: false, demoDismissed: false };
export const HISTORY_DAYS = 7;
