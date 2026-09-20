import { dateKey, nowRingTs } from '../codec';
import { buildTemplateReport, type Report, type ReportMode } from '../domain';
import { keepLastDays, recentTemplateIds, type DaySnapshot, type VueloState } from '../storage';
import type { SyncResult } from '../ble/sync';

/** До 11:00 — про ночь, до 18:00 — про текущий день, позже — итог дня. */
export const reportMode = (now: Date): ReportMode =>
  now.getHours() < 11 ? 'morning' : now.getHours() < 18 ? 'day' : 'evening';

export const reportTitle = (mode: ReportMode) =>
  mode === 'morning' ? 'Как прошла ночь' : mode === 'day' ? 'Как идёт день' : 'Как прошёл день';

export const todayKey = (now = new Date()) => dateKey(nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60));

export const findDay = (days: DaySnapshot[], date: string): DaySnapshot | null =>
  days.find((d) => d.date === date) ?? null;

/** Семь календарных дней подряд, последний — сегодня. День без данных остаётся пустым. */
export function weekDays(days: DaySnapshot[], now = new Date()): { date: string; day: DaySnapshot | null }[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayTs = Date.parse(`${todayKey(now)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(todayTs - (6 - i) * 86400000).toISOString().slice(0, 10);
    return { date, day: byDate.get(date) ?? null };
  });
}

const c = (score: number | null) => ({ score, weight: score === null ? 0 : 1 });

const EMPTY_SCORE = {
  total: null,
  sleep: c(null),
  activity: c(null),
  state: c(null),
  restingHr: null,
  stateInputs: { hrv: false, restingHr: false },
};

const scoreOf = (day: DaySnapshot) => ({
  total: day.total,
  sleep: c(day.scores.sleep),
  activity: c(day.scores.activity),
  state: c(day.scores.state),
  restingHr: day.restingHr === null ? null : { value: day.restingHr, source: day.restingHrSource ?? ('day' as const) },
  stateInputs: day.stateInputs,
});

/** Отчёт за сегодня, уже выданный ранее: чтобы при перезапуске текст не менялся. */
export function savedReport(state: VueloState, now = new Date()): Report | null {
  const mode = reportMode(now);
  const stored = state.reports.find((r) => r.date === todayKey(now) && r.mode === mode);
  return stored ? { text: stored.text, focus: null, templateId: stored.templateId } : null;
}

/** Отчёт для показа: сохранённый за сегодня, иначе собранный из текущих данных. */
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

/**
 * Результат синхронизации поверх состояния.
 * Кэш хранит ровно одну последнюю выгрузку: новые дни не дописываются к старым, а заменяют их.
 */
export function applySync(state: VueloState, days: DaySnapshot[], sync: SyncResult, now = new Date()) {
  const kept = keepLastDays(days);
  const today = findDay(kept, todayKey(now));
  const report = buildTemplateReport({
    mode: reportMode(now),
    score: today ? scoreOf(today) : EMPTY_SCORE,
    recentTemplateIds: recentTemplateIds(state.reports),
  });
  return {
    state: { ...state, days: kept, lastSyncAt: now.getTime(), battery: sync.battery ?? state.battery },
    report,
  };
}

/** «Обновлено 15:40» — короткая строка для шапки. */
export function syncStatusText(state: VueloState): string {
  if (state.lastSyncAt === null) return 'Ещё не обновляли';
  const d = new Date(state.lastSyncAt);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `Обновлено ${time}` : `Обновлено ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
