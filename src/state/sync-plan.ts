import type { KnownRing } from '../ble/ring';
import type { SyncResult } from '../ble/sync';
import { buildTemplateReport } from '../domain';
import {
  CACHE_DAYS,
  addReport,
  buildSnapshots,
  keepLastDays,
  mergeRaw,
  profileAge,
  recentTemplateIds,
  splitByDay,
  toSyncResult,
  type VueloState,
} from '../storage';
import { DAY_START_HOUR, adviceMode, dayView, findDay, scoreOf, todayKey } from './day';

/** Сегодня и вчера запрашиваем всегда: ночь через полночь кольцо отдаёт двумя днями, а сон приходит днём. */
export const ALWAYS_DAYS = 2;
/** Глубина выгрузки: кольцо хранит неделю. */
export const TOTAL_DAYS = 7;
/**
 * До этого часа сессия «ночная»: в логах 00:49 и 01:37 кольцо не отдало сон ни за один день.
 * Дни, выгруженные ночью, завершёнными не отмечаем — иначе их сон потом не забрать.
 */
export const NIGHT_SESSION_UNTIL_HOUR = DAY_START_HOUR;

/** Календарная дата для смещения в днях назад от сегодняшней. */
export const dateForOffset = (offset: number, today: string): string =>
  new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);

const short = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * Какие дни запросить у кольца. Сегодня и вчера — всегда; дни 2–6 — только если они
 * ещё не выгружены целиком (все потоки закрыты маркером). Пустой, но закрытый маркером
 * день — завершённый: кольцо подтвердило, что данных нет.
 * `note` — строка для отладочного лога: что запросили и почему.
 */
export function planDays(completeDates: readonly string[], now = new Date()): { days: number[]; note: string } {
  const today = todayKey(now);
  const done = new Set(completeDates);
  const days: number[] = [];
  const asked: string[] = [];
  const cached: string[] = [];
  for (let day = 0; day < TOTAL_DAYS; day++) {
    const date = dateForOffset(day, today);
    if (day < ALWAYS_DAYS) {
      days.push(day);
      asked.push(`${day} ${day === 0 ? 'сегодня' : 'вчера'}`);
    } else if (!done.has(date)) {
      days.push(day);
      asked.push(`${day} ${short(date)} нет в кэше`);
    } else {
      cached.push(`${day}`);
    }
  }
  const note = `запрос дней: ${asked.join(', ')}${cached.length ? `; из кэша: ${cached.join(', ')}` : ''}`;
  return { days, note };
}

/**
 * Отмечает завершённые дни. Сегодняшний не отмечаем никогда — он ещё идёт;
 * в ночной сессии не отмечаем ничего — кольцо тогда не отдаёт сон.
 */
export function markComplete(previous: readonly string[], completeDays: readonly number[], now = new Date()): string[] {
  if (now.getHours() < NIGHT_SESSION_UNTIL_HOUR) return [...previous];
  const today = todayKey(now);
  const fresh = completeDays.filter((d) => d >= 1).map((d) => dateForOffset(d, today));
  return [...new Set([...previous, ...fresh])].sort().slice(-CACHE_DAYS);
}

/**
 * Результат выгрузки поверх состояния. Единственное место, где данные кольца попадают в кэш:
 * ряды дополняются по дню и типу (пустое не затирает), сводки пересчитываются из рядов,
 * завершённые дни отмечаются. При обрыве связи сохраняем, что успело прийти,
 * но «Обновлено» не ставим: время последней удачной синхронизации остаётся прежним.
 */
export function applySyncResult(
  state: VueloState,
  sync: SyncResult,
  known: KnownRing | null = null,
  now = new Date(),
): VueloState {
  const raw = mergeRaw(state.raw, splitByDay(sync));
  const days = keepLastDays(buildSnapshots(toSyncResult(raw), profileAge(state.profile, now) ?? state.age));
  const base: VueloState = {
    ...state,
    raw,
    days,
    ring: known ?? state.ring,
    completeDays: markComplete(state.completeDays, sync.completeDays, now),
    battery: sync.battery ?? state.battery,
    batteryAt: sync.battery !== null ? now.getTime() : state.batteryAt,
    caloriesToday: sync.activity ? sync.activity.calories : state.caloriesToday,
    caloriesDate: sync.activity ? todayKey(now) : state.caloriesDate,
  };
  if (sync.error) return { ...base, syncFailed: true };
  return { ...base, lastSyncAt: now.getTime(), syncFailed: false, reports: withAdvice(state.reports, days, now) };
}

/**
 * Совет пишем в историю только для полного дня: сегодня, если он полный, иначе последний полный.
 * Шаблон подбираем без учёта прежнего совета на тот же день и режим: пока слабая сторона
 * та же, текст не прыгает от синхронизации к синхронизации.
 */
function withAdvice(reports: VueloState['reports'], days: VueloState['days'], now: Date): VueloState['reports'] {
  const date = dayView(days, now).lastComplete;
  const day = date ? findDay(days, date) : null;
  if (!date || !day) return reports;
  const mode = adviceMode(date, now);
  const others = reports.filter((r) => !(r.date === date && r.mode === mode));
  const report = buildTemplateReport({ mode, score: scoreOf(day), recentTemplateIds: recentTemplateIds(others) });
  return addReport(reports, { date, mode, templateId: report.templateId, text: report.text });
}
