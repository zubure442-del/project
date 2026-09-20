import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_STATE, HISTORY_DAYS, type StoredReport, type VueloState } from './types';

const KEY = 'vuelo/state/v1';

/** Состояние живёт только на телефоне: ни сервера, ни базы данных нет. */
export async function loadState(): Promise<VueloState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<VueloState>;
    return {
      days: parsed.days ?? [],
      reports: parsed.reports ?? [],
      lastSyncAt: parsed.lastSyncAt ?? null,
      battery: parsed.battery ?? null,
      ring: parsed.ring ?? null,
      age: parsed.age ?? null,
      demo: false,
    };
  } catch {
    return EMPTY_STATE; // повреждённое хранилище не должно ломать запуск
  }
}

export async function saveState(state: VueloState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}

export async function clearState(): Promise<VueloState> {
  await AsyncStorage.removeItem(KEY);
  return EMPTY_STATE;
}

/** Советы за последние 7 дней: чтобы отчёт не повторялся. */
export function addReport(reports: StoredReport[], report: StoredReport): StoredReport[] {
  const rest = reports.filter((r) => !(r.date === report.date && r.mode === report.mode));
  return [...rest, report].slice(-HISTORY_DAYS * 2);
}

export const recentTemplateIds = (reports: StoredReport[]): string[] => reports.map((r) => r.templateId);
