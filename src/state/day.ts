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

/** Результат синхронизации поверх состояния: ряды дополняются по дню и типу данных. */
export function applySync(state: VueloState, days: DaySnapshot[], sync: SyncResult, now = new Date()) {
  const kept = keepLastDays(days);
  const today = findDay(kept, todayKey(now));
  const report = buildTemplateReport({
    mode: reportMode(now),
    score: today ? scoreOf(today) : EMPTY_SCORE,
    recentTemplateIds: recentTemplateIds(state.reports),
  });
  return {
    state: {
      ...state,
      days: kept,
      lastSyncAt: now.getTime(),
      syncFailed: false,
      battery: sync.battery ?? state.battery,
    },
    report,
  };
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Статус для шапки. «Обновлено» ставим только после удачной синхронизации:
 * старое время с бодрым словом выглядело бы так, будто всё в порядке.
 */
export function syncStatusText(state: VueloState): string {
  if (state.lastSyncAt === null) return state.syncFailed ? 'Не удалось обновить' : 'Ещё не обновляли';
  if (state.syncFailed) return `Не удалось обновить · данные на ${clock(state.lastSyncAt)}`;
  const d = new Date(state.lastSyncAt);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `Обновлено ${clock(state.lastSyncAt)}` : `Обновлено ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
