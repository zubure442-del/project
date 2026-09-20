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

/**
 * Отчёт для показа. Сохранённый за сегодня, иначе собранный из текущих данных.
 * Без второго шага карточка пропадала при смене утра на вечер, пока нет новой синхронизации.
 */
export function reportToShow(state: VueloState, today: DaySnapshot | null, now = new Date()): Report | null {
  const stored = savedReport(state, now);
  if (stored) return stored;
  if (!today) return null;
  return buildTemplateReport({
    mode: reportMode(now),
    score: scoreOf(today),
    recentTemplateIds: recentTemplateIds(state.reports),
  });
}

const scoreOf = (day: DaySnapshot) => ({
  total: day.total,
  sleep: c(day.scores.sleep),
  activity: c(day.scores.activity),
  state: c(day.scores.state),
  restingHr: day.restingHr,
});

export function applySync(state: VueloState, sync: SyncResult, now = new Date(), demo = false): { state: VueloState; report: Report } {
  const days = mergeSnapshots(state.days, buildSnapshots(sync, state.age));
  const today = findToday(days, now);
  const mode = reportMode(now);
  const report = buildTemplateReport({
    mode,
    score: today ? scoreOf(today) : { total: null, sleep: c(null), activity: c(null), state: c(null), restingHr: null },
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

/** Строка статуса для шапки: когда в последний раз получили данные от кольца. */
export function syncStatusText(state: VueloState, now = Date.now()): string {
  if (state.demo) return 'Показаны демо-данные';
  if (state.lastSyncAt === null) return 'Ещё не синхронизировано';
  const minutes = Math.floor((now - state.lastSyncAt) / 60000);
  if (minutes < 1) return 'Синхронизировано только что';
  if (minutes < 60) return `Синхронизировано ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Синхронизировано ${hours} ч назад`;
  return `Синхронизировано ${Math.floor(hours / 24)} дн назад`;
}
