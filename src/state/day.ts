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

/** День полный, если посчитаны все три составляющие — тогда есть и итог. */
export const isCompleteDay = (day: DaySnapshot | null): boolean => !!day && day.total !== null;

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export interface DayView {
  today: string;
  yesterday: string;
  /** Последний полный день не позже сегодняшнего: для него пишется совет в историю. */
  lastComplete: string | null;
  /** Какой день открывать по умолчанию на всех вкладках. */
  defaultDate: string;
}

/**
 * Какой день открывать: сегодняшний (до четырёх утра — вчерашние сутки, ночь не закончилась).
 * Никаких перебросов на вчера: если у дня нет всех трёх метрик, «Сегодня» показывает экран
 * калибровки, а Сон, Активность и Организм не открываются, пока не выбран полный день.
 */
export function dayView(days: DaySnapshot[], now = new Date()): DayView {
  const today = todayKey(now);
  const yesterday = shiftDate(today, -1);
  const preferred = now.getHours() < DAY_START_HOUR ? yesterday : today;
  const complete = days.filter((d) => d.date <= today && isCompleteDay(d)).map((d) => d.date).sort();
  return { today, yesterday, lastComplete: complete.length ? complete[complete.length - 1] : null, defaultDate: preferred };
}

/** Какой день показан на всех вкладках: выбор из календаря действует до следующей синхронизации. */
export function selectedDay(
  picked: { date: string; key: number } | null,
  view: DayView,
  weekDates: readonly string[],
  syncKey: number,
): string {
  const valid = picked !== null && picked.key === syncKey && weekDates.includes(picked.date);
  return valid ? picked.date : view.defaultDate;
}

/** Старое имя: день по умолчанию. */
export const defaultDay = (days: DaySnapshot[], now = new Date()): string => dayView(days, now).defaultDate;

/** Плашки над экраном. Видна одна, по приоритету: ошибка синхронизации → биометрия → цель. */
export type BannerKind = 'sync-failed' | 'biometry' | 'goal';

export function bannerKind(input: { syncFailed: boolean; profileReady: boolean; goalReady?: boolean }): BannerKind | null {
  if (input.syncFailed) return 'sync-failed';
  if (!input.profileReady) return 'biometry';
  if (input.goalReady === false) return 'goal';
  return null;
}

/** Вкладки, которые открываются только для полного дня (все три метрики). */
export const FULL_DAY_TABS = ['sleep', 'activity', 'body'] as const;

/** Можно ли открыть вкладку: «Сегодня» и «Профиль» — всегда, остальные — только для полного дня. */
export const tabAvailable = (route: string, dayComplete: boolean) =>
  dayComplete || !(FULL_DAY_TABS as readonly string[]).includes(route);

/** «вчерашний день» или «18 сентября» — для плашки и подписи совета. */
export function dayPhrase(date: string, view: Pick<DayView, 'yesterday'>): string {
  if (date === view.yesterday) return 'вчерашний день';
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «21 сен» — на кнопке календаря и на центральной вкладке, когда выбран не сегодня. */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]}`;
}

/** Подпись центральной вкладки: «Сегодня», если выбран сегодняшний день, иначе дата. */
export const todayTabLabel = (selected: string, today: string) => (selected === today ? 'Сегодня' : shortDate(selected));

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
};

export const scoreOf = (day: DaySnapshot) => ({
  total: day.total,
  sleep: c(day.scores.sleep),
  activity: c(day.scores.activity),
  state: c(day.scores.state),
  restingHr: day.restingHr === null ? null : { value: day.restingHr, source: day.restingHrSource ?? ('day' as const) },
});

/** Режим совета для дня: сегодня — по времени суток, прошедший день — «как прошёл день». */
export const adviceMode = (date: string, now = new Date()): ReportMode =>
  date === todayKey(now) ? reportMode(now) : 'evening';

/**
 * Совет для дня. Только для полного дня: по неполному данных не хватает, и совет вышел бы случайным.
 * Уже выданный совет берём из истории, чтобы при перезапуске текст не менялся.
 */
export function adviceFor(state: VueloState, date: string, now = new Date()): Report | null {
  const day = findDay(state.days, date);
  if (!isCompleteDay(day) || !day) return null;
  const mode = adviceMode(date, now);
  const stored = state.reports.find((r) => r.date === date && r.mode === mode);
  if (stored) return { text: stored.text, focus: null, templateId: stored.templateId };
  return buildTemplateReport({ mode, score: scoreOf(day), recentTemplateIds: recentTemplateIds(state.reports) });
}

/** Подпись над советом: «Совет», «Совет · вчера», «Совет · 18 сентября». */
export function adviceLabel(date: string, now = new Date()): string {
  const view = { yesterday: shiftDate(todayKey(now), -1) };
  if (date === todayKey(now)) return 'Совет';
  return date === view.yesterday ? 'Совет · вчера' : `Совет · ${dayPhrase(date, view)}`;
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
