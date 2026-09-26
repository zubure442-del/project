import {
  AI_TEMPLATE_ID,
  EFFORT_TEXT,
  adviceAbout,
  cleanAdvice,
  coffeeClock,
  isAiTemplate,
  isSafeAdvice,
  type AdviceAbout,
  type AdvicePayload,
  type ReportMode,
} from '../domain';
import { nowRingTs } from '../codec';
import { addReport, profileAge, type StoredReport, type VueloState } from '../storage';
import { adviceDaysFor } from './advice-days';
import { currentCycle } from './cycle';
import { DAY_START_HOUR, adviceModeNow, recommendationsFor, todayKey } from './day';

/**
 * Адрес посредника и ключ приложения — из файла `.env` в корне проекта (в git не попадает):
 *   EXPO_PUBLIC_ADVICE_URL=https://functions.yandexcloud.net/…
 *   EXPO_PUBLIC_ADVICE_KEY=…
 * Expo подставляет их при сборке. Нет адреса — ИИ выключен, работает шаблонный совет.
 * Ключ в приложении не секрет в строгом смысле (его можно достать из сборки): он лишь
 * отсекает случайные вызовы. Настоящая защита — лимит бюджета в Yandex Cloud.
 */
export function aiAdviceConfig(): { url: string; key: string } | null {
  const url = process.env.EXPO_PUBLIC_ADVICE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_ADVICE_KEY ?? '';
  return url && key ? { url, key } : null;
}

/** Сколько ждём ответа посредника: дольше человек уже смотрит на шаблонный совет. */
export const AI_ADVICE_TIMEOUT_MS = 15000;
/** Сколько последних советов отдаём модели, чтобы она не повторялась. */
export const AI_ADVICE_RECENT = 3;
/** Запрос на тот же цикл и отрезок не удался — снова не раньше чем через столько (не тратим деньги впустую). */
export const AI_ADVICE_RETRY_MS = 30 * 60 * 1000;

/** Отрезок словами — для отладочного лога. */
export const AI_ADVICE_SLOT_TEXT: Record<ReportMode, string> = { morning: 'после пробуждения', day: 'днём', evening: 'перед сном' };

/** Ключ отрезка: дата начала цикла и отрезок («2026-09-25 morning»). */
export const aiAdviceKey = (request: Pick<AiAdviceRequest, 'date' | 'mode'>) => `${request.date} ${request.mode}`;

/** Можно ли просить снова: по этому отрезку не спрашивали или прошлая попытка была давно. */
export const aiAdviceDue = (lastTry: number | undefined, now = Date.now()) =>
  lastTry === undefined || now - lastTry >= AI_ADVICE_RETRY_MS;

export interface AiAdviceRequest {
  date: string;
  mode: ReportMode;
  /**
   * Шаблонный совет, который заменяем; null — в истории на этот отрезок ещё ничего нет (отрезок
   * сменился между выгрузками). Если к ответу там уже другое — ответ не применяем.
   */
  templateId: string | null;
  payload: AdvicePayload;
}

/**
 * На какой цикл и отрезок нужно мнение от модели: текущий цикл с итогом и его отрезок, если мнения
 * от модели на него ещё нет. null — не нужно (уже есть, нет итога, демо).
 */
export function aiAdviceTarget(
  state: VueloState,
  now = new Date(),
  force = false,
): { date: string; mode: ReportMode; stored: StoredReport | null } | null {
  if (state.demo) return null;
  const cycle = currentCycle(state);
  if (!cycle || cycle.total === null) return null;
  const mode = adviceModeNow(state, now);
  const stored = state.reports.find((r) => r.date === cycle.date && r.mode === mode) ?? null;
  // `force` — меню разработчика: новое мнение на тот же отрезок поверх уже полученного.
  return stored && isAiTemplate(stored.templateId) && !force ? null : { date: cycle.date, mode, stored };
}

const SLOT_ORDER: Record<ReportMode, number> = { morning: 0, day: 1, evening: 2 };
const SLOT_WHEN: Record<ReportMode, string> = { morning: 'утром', day: 'днём', evening: 'вечером' };
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Недавние советы по порядку — последние AI_ADVICE_RECENT до текущего. */
function recentReports(reports: readonly StoredReport[], date: string, except: StoredReport | null): StoredReport[] {
  return [...reports]
    .filter((r) => r !== except && r.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER[a.mode] - SLOT_ORDER[b.mode])
    .slice(-AI_ADVICE_RECENT);
}

/**
 * Недавние мнения для модели — с тем, когда они были сказаны («сегодня утром — …»), по порядку:
 * Лис продолжает историю дня (утром советовал лечь пораньше — вечером видит, что вышло), а не
 * начинает каждый раз с нуля (владелец 26.09: «как будто не следит за тобой»).
 */
export function recentOpinions(reports: readonly StoredReport[], date: string, except: StoredReport | null): string[] {
  const day = (d: string) => (d === date ? 'сегодня' : d === shiftDate(date, -1) ? 'вчера' : 'раньше');
  return recentReports(reports, date, except).map((r) => `${day(r.date)} ${SLOT_WHEN[r.mode]} — ${r.text}`);
}

/**
 * Мнения от модели за последние 7 дней, свежие первыми (текущий отрезок не входит): из них посредник
 * собирает уже предложенные микро-действия, чтобы модель их не повторяла (владелец 26.09).
 */
export function pastOpinions(reports: readonly StoredReport[], date: string, except: StoredReport | null): { ago: number; slot: ReportMode; text: string }[] {
  const ago = (d: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  return [...reports]
    .filter((r) => r !== except && isAiTemplate(r.templateId) && ago(r.date) >= 0 && ago(r.date) < AI_ADVICE_HISTORY_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date) || SLOT_ORDER[b.mode] - SLOT_ORDER[a.mode])
    .slice(0, AI_ADVICE_HISTORY_DAYS * 3)
    .map((r) => ({ ago: ago(r.date), slot: r.mode, text: r.text.slice(0, 400) }));
}

/** Сколько дней истории тем уходит посреднику. */
export const AI_ADVICE_HISTORY_DAYS = 7;

/** О чём Лис говорил за последние дни: метки главного, свежие первыми (текущий отрезок не входит). */
export function focusHistory(reports: readonly StoredReport[], date: string, except: StoredReport | null): { ago: number; focus: string[] }[] {
  const ago = (d: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  return [...reports]
    .filter((r) => r !== except && r.focus?.length && ago(r.date) >= 0 && ago(r.date) < AI_ADVICE_HISTORY_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date) || SLOT_ORDER[b.mode] - SLOT_ORDER[a.mode])
    .slice(0, AI_ADVICE_HISTORY_DAYS * 3)
    .map((r) => ({ ago: ago(r.date), focus: (r.focus ?? []).slice(0, 4) }));
}

/**
 * О чём были те же мнения — строка в строку с `recentOpinions` (владелец 26.09: «выдаёт одно и то же
 * три раза подряд»): по меткам посредник не даёт Лису говорить об одном и том же и повторять совет.
 */
export function recentAbout(reports: readonly StoredReport[], date: string, except: StoredReport | null): (AdviceAbout | null)[] {
  return recentReports(reports, date, except).map((r) =>
    r.focus || r.action ? { focus: r.focus ?? [], action: r.action ?? null } : null,
  );
}

/** Цикл в кэше, скорее всего, уже закончился: с подъёма прошло столько часов, а новая ночь ещё на кольце. */
export const FOX_STALE_CYCLE_HOURS = 20;

/** Что видно на карточке, пока Лис готовит мнение, — по отрезку. */
export const FOX_THINKING_TEXT: Record<ReportMode, string> = {
  morning: 'Лис смотрит, как прошла ночь',
  day: 'Лис смотрит, как идёт день',
  evening: 'Лис подводит итог дня',
};

/**
 * Показывать ли вместо совета «Лис смотрит…»: свежее мнение от модели вот-вот будет, и старый текст
 * (особенно вчерашний вечерний утром) выглядел бы неактуально (владелец 26.09). Отрезок — для текста.
 * - запрос к модели уже идёт;
 * - или идёт выгрузка, а после неё модель спросят: на текущий отрезок мнения от модели нет
 *   (и прошлая неудачная попытка была давно), либо цикл в кэше, похоже, закончился — утро,
 *   новая ночь ещё на кольце.
 * Нет ИИ (нет `.env`) и в демо — никогда: там сразу шаблон.
 */
export function foxThinking(input: {
  state: VueloState;
  now?: Date;
  aiOn: boolean;
  syncing: boolean;
  requesting: ReportMode | null;
  lastTry?: (key: string) => number | undefined;
}): ReportMode | null {
  const { state, aiOn, syncing, requesting } = input;
  const now = input.now ?? new Date();
  if (!aiOn || state.demo) return null;
  if (requesting) return requesting;
  if (!syncing) return null;
  const cycle = currentCycle(state);
  if (!cycle) return null;
  const nowTs = nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60);
  // Ночью (до 4:00) ночь ещё не кончилась — «как прошла ночь» говорить рано.
  if (nowTs - cycle.start >= FOX_STALE_CYCLE_HOURS * 3600 && now.getHours() >= DAY_START_HOUR) return 'morning';
  const target = aiAdviceTarget(state, now);
  if (!target) return null;
  return aiAdviceDue(input.lastTry?.(aiAdviceKey(target)), now.getTime()) ? target.mode : null;
}

/**
 * Какой совет попросить у модели. Тот же, что показывает «Сегодня» (`adviceFor`): текущий цикл
 * с итогом и его отрезок — после пробуждения, днём или перед сном (`adviceModeNow`). Совет от модели
 * на этот цикл и отрезок уже есть — не просим: текст не должен меняться от синхронизации
 * к синхронизации, и лишние запросы стоят денег. Так за цикл выходит не больше трёх запросов.
 * В демо-режиме к модели не ходим.
 *
 * Модели отдаём всё, кроме имени (решение владельца 26.09): профиль, оценки, таблицу чисел
 * за последнюю неделю и сегодня (`adviceDaysFor`), шаги сегодня по часам и план Vuelo на сегодня
 * (тренировка, кофе, еда, время отхода ко сну). Готовых выводов приложение не шлёт: посредник
 * (`server/advice`) сравнивает числа с личной нормой, что главное и почему — решает модель.
 * Значений глюкозы и давления не отдаём — только время подъёмов глюкозы (обычно это еда).
 */
export function aiAdviceRequest(state: VueloState, now = new Date(), force = false): AiAdviceRequest | null {
  const target = aiAdviceTarget(state, now, force);
  const cycle = currentCycle(state);
  if (!target || !cycle) return null;
  const { mode, stored } = target;

  const today = todayKey(now);
  const rec = recommendationsFor(state, today, now);
  const coffee = rec?.coffee ?? null;
  const endurance = rec?.endurance ?? null;
  const sleepMode = rec?.sleepMode ?? null;
  const { profile } = state;
  const { days, hours } = adviceDaysFor(state, now);

  return {
    date: cycle.date,
    mode,
    templateId: stored?.templateId ?? null,
    payload: {
      mode,
      time: coffeeClock(now.getHours() * 60 + now.getMinutes()),
      profile: {
        sex: profile.sex,
        age: profileAge(profile, now) ?? state.age,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        goal: profile.goal ?? null,
      },
      scores: { total: cycle.total, sleep: cycle.scores.sleep, activity: cycle.scores.activity, organism: cycle.scores.state },
      days,
      hours,
      plan: {
        workout: endurance
          ? {
              title: endurance.plan.title,
              effort: EFFORT_TEXT[endurance.plan.effort],
              minutes: endurance.plan.minutes,
              from: coffeeClock(endurance.from),
              to: coffeeClock(endurance.to),
            }
          : null,
        coffee:
          coffee && coffee.kind === 'window'
            ? { from: coffeeClock(coffee.start), until: coffeeClock(coffee.cutoff), cups: coffee.cups?.n ?? null }
            : null,
        noCoffee: coffee?.kind === 'no-window',
        meals: (rec?.food?.meals ?? []).map((m) => ({ title: m.title, time: coffeeClock(m.minute) })),
        bedtime: sleepMode
          ? {
              from: coffeeClock(sleepMode.from),
              to: coffeeClock(sleepMode.to),
              wake: coffeeClock(sleepMode.wake),
              needMinutes: sleepMode.needMin,
              debtMinutes: sleepMode.debtMin,
            }
          : null,
      },
      recent: recentOpinions(state.reports, cycle.date, stored),
      said: recentAbout(state.reports, cycle.date, stored),
      history: focusHistory(state.reports, cycle.date, stored),
      past_opinions: pastOpinions(state.reports, cycle.date, stored),
    },
  };
}

/**
 * Совет от модели вместо шаблонного — только если шаблонный за время запроса не сменился
 * (шаблона не было, а выгрузка успела его записать, — не смена: мнение модели его и заменяет).
 * `about` — о чём мнение (метки посредника): запоминаем, чтобы Лис не ходил по кругу.
 */
export function withAiAdvice(state: VueloState, request: AiAdviceRequest, text: string, about: AdviceAbout | null = null): VueloState {
  const stored = state.reports.find((r) => r.date === request.date && r.mode === request.mode);
  const same = stored === undefined || stored.templateId === request.templateId || (request.templateId === null && !isAiTemplate(stored.templateId));
  if (!same) return state;
  const report: StoredReport = { date: request.date, mode: request.mode, templateId: AI_TEMPLATE_ID, text, ...(about ?? {}) };
  return { ...state, reports: addReport(state.reports, report) };
}

export type AiAdviceResult = { text: string; about?: AdviceAbout; server?: number } | { error: string };

/** Версия кода облачной функции, с которой приложение работает полностью (разговор за день, метки). */
export const AI_ADVICE_SERVER_VERSION = 8;

/** Запрос к посреднику. Любая неудача — `error` с причиной для отладочного лога, без исключений. */
export async function fetchAiAdvice(
  payload: AdvicePayload,
  config: { url: string; key: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = AI_ADVICE_TIMEOUT_MS,
): Promise<AiAdviceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vuelo-Key': config.key },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return { error: `посредник ответил ${response.status}` };
    const data = (await response.json()) as { text?: unknown; focus?: unknown; action?: unknown; v?: unknown };
    if (typeof data.text !== 'string') return { error: 'в ответе нет текста' };
    const text = cleanAdvice(data.text);
    if (!isSafeAdvice(text)) return { error: 'текст не прошёл проверку' };
    const about = adviceAbout(data);
    const server = typeof data.v === 'number' ? { server: data.v } : {};
    return about ? { text, about, ...server } : { text, ...server };
  } catch (e) {
    return { error: controller.signal.aborted ? 'нет ответа за 15 с' : `нет связи (${String(e)})` };
  } finally {
    clearTimeout(timer);
  }
}
