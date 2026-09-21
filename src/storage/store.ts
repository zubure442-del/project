import AsyncStorage from '@react-native-async-storage/async-storage';
import { migrateSnapshots } from './raw';
import { EMPTY_PROFILE, EMPTY_STATE, HISTORY_DAYS, type Profile, type StoredReport, type VueloState } from './types';

const KEY = 'vuelo/state/v1';

/** Состояние живёт только на телефоне: ни сервера, ни базы данных нет. */
export async function loadState(): Promise<VueloState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<VueloState>;
    return {
      days: parsed.days ?? [],
      // Старый кэш без рядов переносим, иначе сон пропадёт при первой же синхронизации.
      raw: parsed.raw ?? migrateSnapshots(parsed.days ?? []),
      reports: parsed.reports ?? [],
      lastSyncAt: parsed.lastSyncAt ?? null,
      syncFailed: parsed.syncFailed ?? false,
      // Старый кэш не знал времени выгрузки дней: один раз выгрузим неделю целиком.
      syncedAt: parsed.syncedAt ?? {},
      syncDurations: parsed.syncDurations ?? { long: [], short: [] },
      stepNorms: parsed.stepNorms ?? {},
      battery: parsed.battery ?? null,
      caloriesToday: parsed.caloriesToday ?? null,
      caloriesDate: parsed.caloriesDate ?? null,
      batteryAt: parsed.batteryAt ?? null,
      autoMeasureMin: parsed.autoMeasureMin ?? 30,
      ring: parsed.ring ?? null,
      age: parsed.age ?? null,
      profile: { ...EMPTY_PROFILE, ...(parsed.profile ?? {}) },
      started: parsed.started ?? false,
    };
  } catch {
    return EMPTY_STATE; // повреждённое хранилище не должно ломать запуск
  }
}

/** Профиль прямо из хранилища: «Профиль» читает его при открытии, а не из устаревшей копии. */
export async function loadProfile(): Promise<Profile> {
  return (await loadState()).profile;
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
