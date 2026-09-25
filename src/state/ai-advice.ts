import {
  AI_TEMPLATE_ID,
  buildTemplateReport,
  cleanAdvice,
  isAiTemplate,
  isSafeAdvice,
  type AdvicePayload,
  type ReportMode,
} from '../domain';
import { addReport, type VueloState } from '../storage';
import { currentCycle } from './cycle';
import { cycleScoreOf, findDay, reportMode } from './day';

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

export interface AiAdviceRequest {
  date: string;
  mode: ReportMode;
  /** Шаблонный совет, который заменяем: если к ответу он уже другой — ответ не применяем. */
  templateId: string;
  payload: AdvicePayload;
}

/**
 * Какой совет попросить у модели. Тот же, что показывает «Сегодня» (`adviceFor`): текущий цикл
 * с итогом и время суток. Совет от модели на этот цикл и время суток уже есть — не просим:
 * текст не должен меняться от синхронизации к синхронизации, и лишние запросы стоят денег.
 * В демо-режиме к модели не ходим.
 */
export function aiAdviceRequest(state: VueloState, now = new Date()): AiAdviceRequest | null {
  if (state.demo) return null;
  const cycle = currentCycle(state);
  if (!cycle || cycle.total === null) return null;
  const mode = reportMode(now);
  const stored = state.reports.find((r) => r.date === cycle.date && r.mode === mode);
  if (!stored || isAiTemplate(stored.templateId)) return null;
  const day = findDay(state.days, cycle.date);
  const weakest = buildTemplateReport({ mode, score: cycleScoreOf(cycle), recentTemplateIds: [] }).focus;
  return {
    date: cycle.date,
    mode,
    templateId: stored.templateId,
    payload: {
      mode,
      goal: state.profile.goal ?? null,
      total: cycle.total,
      sleep: {
        score: cycle.scores.sleep,
        minutes: cycle.sleep?.totalMin ?? null,
        deepMinutes: cycle.sleep?.deepMin ?? null,
      },
      activity: { score: cycle.scores.activity, steps: cycle.steps, norm: day?.stepNorm?.value ?? null },
      organism: { score: cycle.scores.state },
      weakest,
      recent: state.reports
        .filter((r) => r !== stored)
        .slice(-AI_ADVICE_RECENT)
        .map((r) => r.text),
    },
  };
}

/** Совет от модели вместо шаблонного — только если шаблонный за время запроса не сменился. */
export function withAiAdvice(state: VueloState, request: AiAdviceRequest, text: string): VueloState {
  const stored = state.reports.find((r) => r.date === request.date && r.mode === request.mode);
  if (!stored || stored.templateId !== request.templateId) return state;
  return { ...state, reports: addReport(state.reports, { date: request.date, mode: request.mode, templateId: AI_TEMPLATE_ID, text }) };
}

export type AiAdviceResult = { text: string } | { error: string };

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
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== 'string') return { error: 'в ответе нет текста' };
    const text = cleanAdvice(data.text);
    return isSafeAdvice(text) ? { text } : { error: 'текст не прошёл проверку' };
  } catch (e) {
    return { error: controller.signal.aborted ? 'нет ответа за 15 с' : `нет связи (${String(e)})` };
  } finally {
    clearTimeout(timer);
  }
}
