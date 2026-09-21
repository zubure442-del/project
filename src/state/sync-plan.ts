import type { KnownRing } from '../ble/ring';
import type { SyncResult } from '../ble/sync';
import { bodyOf, buildTemplateReport } from '../domain';
import {
  CACHE_DAYS,
  addReport,
  buildSnapshots,
  collectStepNorms,
  keepLastDays,
  mergeRaw,
  profileAge,
  recentTemplateIds,
  splitByDay,
  toSyncResult,
  type VueloState,
} from '../storage';
import { DAY_START_HOUR, adviceMode, dayView, findDay, scoreOf, todayKey } from './day';

/** Глубина выгрузки: кольцо хранит неделю. */
export const TOTAL_DAYS = 7;
/**
 * День D финальный, если его последняя удачная выгрузка была не раньше полудня следующего дня:
 * startOfDay(D+1) + FINAL_AFTER_HOURS. К этому времени ночь кончилась и кольцо отдало весь сон.
 * Финальные дни больше не запрашиваем; сегодня — всегда.
 */
export const FINAL_AFTER_HOURS = 12;
/**
 * До этого часа сессия «ночная»: в логах 00:49 и 01:37 кольцо не отдало сон ни за один день.
 * Время выгрузки ночью не записываем — иначе старые дни стали бы финальными без сна.
 */
export const NIGHT_SESSION_UNTIL_HOUR = DAY_START_HOUR;

/** Календарная дата для смещения в днях назад от сегодняшней. */
export const dateForOffset = (offset: number, today: string): string =>
  new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);

const short = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** Момент, начиная с которого выгрузка дня делает его финальным: полдень следующего дня по местному времени. */
export function finalFrom(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d + 1, FINAL_AFTER_HOURS).getTime();
}

export const isFinalDay = (date: string, syncedAt: Readonly<Record<string, number>>) =>
  syncedAt[date] !== undefined && syncedAt[date] >= finalFrom(date);

/**
 * Какие дни запросить у кольца. Сегодня — всегда; остальные — если их нет в кэше
 * или они ещё не финальные (например, вчера до полудня: сон мог прийти не весь).
 * `note` — строка для отладочного лога: что запросили и почему.
 */
export function planDays(syncedAt: Readonly<Record<string, number>>, now = new Date()): { days: number[]; note: string } {
  const today = todayKey(now);
  const days: number[] = [0];
  const asked: string[] = ['0 сегодня'];
  const cached: string[] = [];
  for (let day = 1; day < TOTAL_DAYS; day++) {
    const date = dateForOffset(day, today);
    if (isFinalDay(date, syncedAt)) {
      cached.push(`${day}`);
    } else {
      days.push(day);
      asked.push(`${day} ${short(date)} ${syncedAt[date] === undefined ? 'нет в кэше' : 'не финальный'}`);
    }
  }
  const note = `запрос дней: ${asked.join(', ')}${cached.length ? `; из кэша: ${cached.join(', ')}` : ''}`;
  return { days, note };
}

/**
 * Записывает время выгрузки дней, пришедших целиком. В ночной сессии не пишем ничего:
 * кольцо тогда не отдаёт сон. Храним не больше CACHE_DAYS дат.
 */
export function markSynced(
  previous: Readonly<Record<string, number>>,
  completeDays: readonly number[],
  now = new Date(),
): Record<string, number> {
  if (now.getHours() < NIGHT_SESSION_UNTIL_HOUR) return { ...previous };
  const today = todayKey(now);
  const next: Record<string, number> = { ...previous };
  for (const day of completeDays) next[dateForOffset(day, today)] = now.getTime();
  const kept = Object.keys(next).sort().slice(-CACHE_DAYS);
  return Object.fromEntries(kept.map((d) => [d, next[d]]));
}

/**
 * Сводки дней заново из рядов: оценки, норма шагов (сохранённая не меняется) и калории
 * по текущему профилю. Вызывается после выгрузки и после правки профиля.
 */
export function rebuildDays(state: VueloState, now = new Date()): VueloState {
  const days = keepLastDays(
    buildSnapshots(toSyncResult(state.raw), profileAge(state.profile, now) ?? state.age, state.stepNorms, bodyOf(state.profile, now), now),
  );
  return { ...state, days, stepNorms: collectStepNorms(state.stepNorms, days) };
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
  const rebuilt = rebuildDays({ ...state, raw }, now);
  const days = rebuilt.days;
  const base: VueloState = {
    ...rebuilt,
    ring: known ?? state.ring,
    battery: sync.battery ?? state.battery,
    batteryAt: sync.battery !== null ? now.getTime() : state.batteryAt,
  };
  if (sync.error) return { ...base, syncFailed: true };
  return {
    ...base,
    lastSyncAt: now.getTime(),
    syncFailed: false,
    syncedAt: markSynced(state.syncedAt, sync.completeDays, now),
    reports: withAdvice(state.reports, days, now),
  };
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
