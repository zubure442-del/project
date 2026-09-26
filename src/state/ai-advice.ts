import {
  AI_TEMPLATE_ID,
  cleanAdvice,
  coffeeClock,
  isAiTemplate,
  isSafeAdvice,
  type AdvicePayload,
  type ReportMode,
} from '../domain';
import { nowRingTs } from '../codec';
import { addReport, type StoredReport, type VueloState } from '../storage';
import { insightFor } from './advice-days';
import { currentCycle } from './cycle';
import { DAY_START_HOUR, adviceModeNow } from './day';

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
  /** Сколько связок нашёл движок и с какими цифрами сравнивал (для «Сырого лога»; посреднику не уходит). */
  options: number;
  debug: string;
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
const daysAgo = (date: string, d: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);

/** Сколько дней истории мнений учитываем: и для проверки повторов, и для выбора связки. */
export const AI_ADVICE_HISTORY_DAYS = 7;

/** Сколько прежних ключей и текстов одного отрезка помним после «Нового мнения Лиса». */
export const AI_ADVICE_MEMORY = 12;

/** Мнения от модели за последние 7 дней, свежие первыми (текущий отрезок не входит). */
function aiReports(reports: readonly StoredReport[], date: string, except: StoredReport | null): StoredReport[] {
  return [...reports]
    .filter((r) => r !== except && isAiTemplate(r.templateId) && daysAgo(date, r.date) >= 0 && daysAgo(date, r.date) < AI_ADVICE_HISTORY_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date) || SLOT_ORDER[b.mode] - SLOT_ORDER[a.mode]);
}

/** Тексты прошлых мнений для посредника: ответ, слишком похожий на них, он отклонит. */
export function pastOpinions(reports: readonly StoredReport[], date: string, except: StoredReport | null): { ago: number; slot: ReportMode; text: string }[] {
  return aiReports(reports, date, except)
    .flatMap((r) => [r.text, ...(r.earlier ?? [])].map((text) => ({ ago: daysAgo(date, r.date), slot: r.mode, text: text.slice(0, 400) })))
    .slice(0, 30);
}

/**
 * О каких связках движка Лис уже говорил (ключ хранится в `StoredReport.focus`): в этом цикле и за неделю.
 * Движок физиологии выберет другую связку, если есть из чего (владелец 26.09: «циклится на одних фразах»).
 */
export function saidInsights(reports: readonly StoredReport[], date: string, except: StoredReport | null): { today: string[]; week: string[] } {
  const list = aiReports(reports, date, except);
  const keys = (rs: StoredReport[]) => rs.flatMap((r) => r.focus ?? []);
  return { today: keys(list.filter((r) => r.date === date)), week: keys(list) };
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
 * Физиологию считает приложение (`insightFor` → движок `physiology.ts`), модели уходят только две
 * фразы: что с телом сейчас и первопричина. Движку не из чего сделать вывод — не просим, остаётся шаблон.
 */
export function aiAdviceRequest(state: VueloState, now = new Date(), force = false): AiAdviceRequest | null {
  const target = aiAdviceTarget(state, now, force);
  const cycle = currentCycle(state);
  if (!target || !cycle) return null;
  const { mode, stored } = target;
  // По кнопке «Новое мнение Лиса» текущее мнение тоже «уже сказано»: движок выберет другую связку.
  const except = force ? null : stored;
  const insight = insightFor(state, mode, saidInsights(state.reports, cycle.date, except), now);
  if (!insight) return null;
  return {
    date: cycle.date,
    mode,
    templateId: stored?.templateId ?? null,
    options: insight.options,
    debug: insight.debug,
    payload: {
      mode,
      time: coffeeClock(now.getHours() * 60 + now.getMinutes()),
      insight: { key: insight.key, consequence: insight.consequence, root_cause: insight.rootCause },
      past_opinions: pastOpinions(state.reports, cycle.date, except),
    },
  };
}

/**
 * Совет от модели вместо шаблонного — только если шаблонный за время запроса не сменился
 * (шаблона не было, а выгрузка успела его записать, — не смена: мнение модели его и заменяет).
 * Ключ связки движка запоминаем (`focus`): в следующий раз Лис выберет другую.
 */
export function withAiAdvice(state: VueloState, request: AiAdviceRequest, text: string): VueloState {
  const stored = state.reports.find((r) => r.date === request.date && r.mode === request.mode);
  const same = stored === undefined || stored.templateId === request.templateId || (request.templateId === null && !isAiTemplate(stored.templateId));
  if (!same) return state;
  // Кнопка «Новое мнение Лиса» перезаписывает мнение того же отрезка: прежние ключи и тексты
  // сохраняем, иначе ротация ходила по кругу между двумя связками, а проверка повторов не видела
  // ранних текстов (владелец 26.09: «пишет одинаковые тексты слово в слово»).
  const prev = stored && isAiTemplate(stored.templateId) ? stored : null;
  const report: StoredReport = {
    date: request.date,
    mode: request.mode,
    templateId: AI_TEMPLATE_ID,
    text,
    focus: [request.payload.insight.key, ...(prev?.focus ?? [])].slice(0, AI_ADVICE_MEMORY),
    ...(prev ? { earlier: [prev.text, ...(prev.earlier ?? [])].slice(0, AI_ADVICE_MEMORY) } : {}),
  };
  return { ...state, reports: addReport(state.reports, report) };
}

/**
 * `engine` — модель дважды не прошла проверку, и посредник вернул саму связку движка; здесь — какая
 * проверка не прошла (для «Сырого лога»).
 */
export type AiAdviceResult = { text: string; server?: number; engine?: string } | { error: string };

/** Версия кода облачной функции, с которой приложение работает (запрос — вывод движка физиологии). */
export const AI_ADVICE_SERVER_VERSION = 14;

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
    if (!response.ok) {
      // Причина от посредника («answer repeat», «llm 403»…) — чтобы в «Сыром логе» было видно, что не так.
      const reason = await response.json().then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error.slice(0, 60) : null)).catch(() => null);
      return { error: `посредник ответил ${response.status}${reason ? ` (${reason})` : ''}` };
    }
    const data = (await response.json()) as { text?: unknown; v?: unknown; mode?: unknown; rejected?: unknown };
    if (typeof data.text !== 'string') return { error: 'в ответе нет текста' };
    const text = cleanAdvice(data.text);
    if (!isSafeAdvice(text)) return { error: 'текст не прошёл проверку' };
    const engine = data.mode === 'engine' ? { engine: typeof data.rejected === 'string' ? data.rejected.slice(0, 30) : 'answer' } : {};
    return typeof data.v === 'number' ? { text, server: data.v, ...engine } : { text, ...engine };
  } catch (e) {
    return { error: controller.signal.aborted ? 'нет ответа за 15 с' : `нет связи (${String(e)})` };
  } finally {
    clearTimeout(timer);
  }
}
