import { dateKey, nowRingTs } from '../codec';
import { buildTemplateReport, formatMinute, type Report, type ReportMode } from '../domain';
import { recentTemplateIds, type DaySnapshot, type VueloState } from '../storage';

/** Если данные свежее десяти минут, к кольцу не идём. */
export const CACHE_FRESH_MS = 10 * 60 * 1000;
/** Заряд старше этого времени показываем приглушённым. */
export const BATTERY_STALE_MS = 30 * 60 * 1000;

/** Данные считаются свежими, если последняя удачная синхронизация была недавно. */
export const isFresh = (state: VueloState, now = Date.now()) =>
  state.lastSyncAt !== null && !state.syncFailed && now - state.lastSyncAt < CACHE_FRESH_MS;

/** До 11:00 — про ночь, до 18:00 — про текущий день, позже — итог дня. */
export const reportMode = (now: Date): ReportMode =>
  now.getHours() < 11 ? 'morning' : now.getHours() < 18 ? 'day' : 'evening';

export const reportTitle = (mode: ReportMode) =>
  mode === 'morning' ? 'Как прошла ночь' : mode === 'day' ? 'Как идёт день' : 'Как прошёл день';

export const todayKey = (now = new Date()) => dateKey(nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60));

export const findDay = (days: DaySnapshot[], date: string): DaySnapshot | null =>
  days.find((d) => d.date === date) ?? null;

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

/** Последний замер кислорода за всю историю: значение и когда. */
export function latestSpo2(days: DaySnapshot[]): { value: number; when: string } | null {
  for (const day of [...days].sort((a, b) => b.date.localeCompare(a.date))) {
    const last = day.spo2[day.spo2.length - 1];
    if (!last) continue;
    const [, month, dayNo] = day.date.split('-');
    return {
      value: last.v,
      when: `${Number(dayNo)} ${MONTHS[Number(month) - 1]} ${formatMinute(last.m)}`,
    };
  }
  return null;
}

/** Граница суток: до этого часа по умолчанию показываем вчерашний день. */
export const DAY_START_HOUR = 4;

/** Есть ли за день хоть что-то: шаги, сон, пульс, сводка или кислород. */
export const dayHasAnything = (day: DaySnapshot | null): boolean =>
  !!day &&
  ((day.steps ?? 0) > 0 ||
    day.sleep !== null ||
    day.heart.length > 0 ||
    day.spo2.length > 0 ||
    day.summaryPoints.length > 0);

/**
 * Какой день открывать. До четырёх утра это ещё «вчера»: ночь не закончилась.
 * Если за нужный день пусто, показываем последний день с данными.
 */
export function defaultDay(days: DaySnapshot[], now = new Date()): string {
  const today = todayKey(now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const preferred = now.getHours() < DAY_START_HOUR ? yesterday : today;
  if (dayHasAnything(findDay(days, preferred))) return preferred;
  const last = [...days].reverse().find(dayHasAnything);
  return last?.date ?? preferred;
}

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

export const EMPTY_SCORE = {
  total: null,
  sleep: c(null),
  activity: c(null),
  state: c(null),
  restingHr: null,
  stateInputs: { hrv: false, restingHr: false, spo2: false },
};

export const scoreOf = (day: DaySnapshot) => ({
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
