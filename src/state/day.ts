import { dateKey, nowRingTs } from '../codec';
import { buildDemoSync, buildTemplateReport, formatMinute, type Report, type ReportMode } from '../domain';
import { buildSnapshots, mergeSnapshots, recentTemplateIds, type DaySnapshot, type VueloState } from '../storage';
import type { SyncResult } from '../ble/sync';

/** До 11:00 — про ночь, до 18:00 — про текущий день («пока»), позже — итог дня. */
export const reportMode = (now: Date): ReportMode =>
  now.getHours() < 11 ? 'morning' : now.getHours() < 18 ? 'day' : 'evening';

export const reportTitle = (mode: ReportMode) =>
  mode === 'morning' ? 'Как прошла ночь' : mode === 'day' ? 'Как идёт день' : 'Как прошёл день';

export const todayKey = (now = new Date()) => dateKey(nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60));

export function findToday(days: DaySnapshot[], now = new Date()): DaySnapshot | null {
  return days.find((d) => d.date === todayKey(now)) ?? null;
}

/** Дни с замерами кислорода за последние N дней, свежие в конце. */
export function spo2Days(days: DaySnapshot[], count = 3, now = new Date()) {
  const today = todayKey(now);
  return days.filter((d) => d.date <= today && d.spo2.length).slice(-count).map((d) => ({ date: d.date, points: d.spo2 }));
}

/** Последний замер кислорода: значение и когда он был. */
export function lastSpo2(days: DaySnapshot[], now = new Date()): { value: number; when: string } | null {
  for (const day of [...days].sort((a, b) => b.date.localeCompare(a.date))) {
    const last = day.spo2[day.spo2.length - 1];
    if (!last) continue;
    return { value: last.v, when: `${relativeDay(day.date, now)} ${formatMinute(last.m)}` };
  }
  return null;
}

const relativeDay = (date: string, now: Date): string => {
  const today = todayKey(now);
  if (date === today) return 'сегодня';
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (date === yesterday) return 'вчера';
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
};

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
  restingHr: day.restingHr === null ? null : { value: day.restingHr, source: day.restingHrSource ?? 'day' as const },
  stateInputs: day.stateInputs,
});

export function applySync(state: VueloState, sync: SyncResult, now = new Date(), demo = false): { state: VueloState; report: Report } {
  const days = mergeSnapshots(state.days, buildSnapshots(sync, state.age));
  const today = findToday(days, now);
  const mode = reportMode(now);
  const report = buildTemplateReport({
    mode,
    score: today ? scoreOf(today) : EMPTY_SCORE,
    recentTemplateIds: recentTemplateIds(state.reports),
  });
  return { state: { ...state, days, lastSyncAt: now.getTime(), battery: sync.battery ?? state.battery, demo }, report };
}

const c = (score: number | null) => ({ score, weight: score === null ? 0 : 1 });

const EMPTY_SCORE = {
  total: null,
  sleep: c(null),
  activity: c(null),
  state: c(null),
  restingHr: null,
  stateInputs: { spo2: false, hrv: false, restingHr: false },
};

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

/** Неделя всегда из семи календарных дней: без данных — пропуск, а не ноль. */
export function weekDays(days: DaySnapshot[], now = new Date()): { date: string; day: DaySnapshot | null }[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayTs = Date.parse(`${todayKey(now)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(todayTs - (6 - i) * 86400000).toISOString().slice(0, 10);
    return { date, day: byDate.get(date) ?? null };
  });
}
