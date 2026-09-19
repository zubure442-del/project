import { dateKey, nowRingTs } from '../codec';
import { buildDemoSync, buildTemplateReport, type Report, type ReportMode } from '../domain';
import { buildSnapshots, mergeSnapshots, recentTemplateIds, type DaySnapshot, type VueloState } from '../storage';
import type { SyncResult } from '../ble/sync';

/** До 11:00 отчёт про ночь, позже — про день. */
export const reportMode = (now: Date): ReportMode => (now.getHours() < 11 ? 'morning' : 'evening');
export const reportTitle = (mode: ReportMode) => (mode === 'morning' ? 'Как прошла ночь' : 'Как прошёл день');

export const todayKey = (now = new Date()) => dateKey(nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60));

export function findToday(days: DaySnapshot[], now = new Date()): DaySnapshot | null {
  return days.find((d) => d.date === todayKey(now)) ?? null;
}

/** SpO2 за последние 3 дня — если сегодня кольцо ещё ничего не записало. */
export function spo2Fallback(days: DaySnapshot[], now = new Date()) {
  const today = todayKey(now);
  const recent = days.filter((d) => d.date < today).slice(-3).filter((d) => d.spo2.length);
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  return { points: last.spo2, days: 3 };
}

/** Отчёт за сегодня, уже выданный ранее: чтобы при перезапуске текст не исчезал и не менялся. */
export function savedReport(state: VueloState, now = new Date()): Report | null {
  const mode = reportMode(now);
  const stored = state.reports.find((r) => r.date === todayKey(now) && r.mode === mode);
  return stored ? { text: stored.text, focus: null, templateId: stored.templateId } : null;
}

export function applySync(state: VueloState, sync: SyncResult, now = new Date(), demo = false): { state: VueloState; report: Report } {
  const days = mergeSnapshots(state.days, buildSnapshots(sync, state.age));
  const today = findToday(days, now);
  const mode = reportMode(now);
  const report = buildTemplateReport({
    mode,
    score: today
      ? { total: today.total, sleep: c(today.scores.sleep), activity: c(today.scores.activity), state: c(today.scores.state), restingHr: today.restingHr }
      : { total: null, sleep: c(null), activity: c(null), state: c(null), restingHr: null },
    recentTemplateIds: recentTemplateIds(state.reports),
  });
  return { state: { ...state, days, lastSyncAt: now.getTime(), demo }, report };
}

const c = (score: number | null) => ({ score, weight: score === null ? 0 : 1 });

/**
 * Демо-данные для показа интерфейса (в симуляторе Bluetooth недоступен).
 * Если сейчас раннее утро, показываем день таким, каким он будет к вечеру:
 * иначе смотреть было бы не на что — настоящий день в это время ещё пуст.
 */
export function demoSync(now = new Date()) {
  const when = new Date(now);
  if (when.getHours() < 12) when.setHours(20, 30, 0, 0);
  return buildDemoSync({ now: when });
}
