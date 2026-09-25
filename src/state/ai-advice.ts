import {
  AI_TEMPLATE_ID,
  EFFORT_TEXT,
  buildTemplateReport,
  cleanAdvice,
  coffeeClock,
  isAiTemplate,
  isSafeAdvice,
  type AdvicePayload,
  type ReportMode,
} from '../domain';
import { addReport, profileAge, type VueloState } from '../storage';
import { currentCycle } from './cycle';
import { cycleScoreOf, findDay, recommendationsFor, reportMode, todayKey } from './day';
import { insightsFor } from './insights';
import { sleepHrFor } from './sleep-hr';

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

/** Кольцевая метка → «ЧЧ:ММ»: метки кольца — местное время, записанное как UTC. */
const clockOfTs = (ts: number) => coffeeClock(Math.floor((((ts % 86400) + 86400) % 86400) / 60));
const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));
const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Какой совет попросить у модели. Тот же, что показывает «Сегодня» (`adviceFor`): текущий цикл
 * с итогом и время суток. Совет от модели на этот цикл и время суток уже есть — не просим:
 * текст не должен меняться от синхронизации к синхронизации, и лишние запросы стоят денег.
 * В демо-режиме к модели не ходим.
 *
 * Модели отдаём всё, что знаем о дне, кроме имени (решение владельца 26.09): профиль, сон
 * и пульс во сне против своей нормы, шаги и калории, замеры «Организма» и план дня из карточек
 * карусели — тренировку, кофе, еду и время отхода ко сну — и наблюдения дня против своей нормы
 * (`insightsFor`): из них Лис делает догадку, что на самом деле происходило. Значений глюкозы
 * и давления не отдаём: о еде Лис говорит через привычки (частые подъёмы — частые перекусы).
 */
export function aiAdviceRequest(state: VueloState, now = new Date()): AiAdviceRequest | null {
  if (state.demo) return null;
  const cycle = currentCycle(state);
  if (!cycle || cycle.total === null) return null;
  const mode = reportMode(now);
  const stored = state.reports.find((r) => r.date === cycle.date && r.mode === mode);
  if (!stored || isAiTemplate(stored.templateId)) return null;

  const today = todayKey(now);
  const startDay = findDay(state.days, cycle.date);
  const calendarDay = findDay(state.days, today);
  const weakest = buildTemplateReport({ mode, score: cycleScoreOf(cycle), recentTemplateIds: [] }).focus;
  const sleepHr = sleepHrFor(state, today, now);
  const rec = recommendationsFor(state, today, now);
  const coffee = rec?.coffee ?? null;
  const endurance = rec?.endurance ?? null;
  const sleepMode = rec?.sleepMode ?? null;
  const { profile } = state;

  return {
    date: cycle.date,
    mode,
    templateId: stored.templateId,
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
      total: cycle.total,
      weakest,
      sleep: {
        score: cycle.scores.sleep,
        minutes: cycle.sleep?.totalMin ?? null,
        deepMinutes: cycle.sleep?.deepMin ?? null,
        lightMinutes: cycle.sleep?.lightMin ?? null,
        asleep: cycle.sleep ? clockOfTs(cycle.sleep.start) : null,
        awake: cycle.sleep ? clockOfTs(cycle.sleep.end) : null,
        pulse: sleepHr
          ? { min: sleepHr.night.min, avg: sleepHr.night.avg, vsNormMin: sleepHr.deltaMin, vsNormAvg: sleepHr.deltaAvg }
          : null,
      },
      activity: {
        score: cycle.scores.activity,
        steps: cycle.steps,
        norm: startDay?.stepNorm?.value ?? null,
        caloriesToday: calendarDay?.calories ?? null,
      },
      organism: {
        score: cycle.scores.state,
        hrv: round(calendarDay?.estimates.hrv),
        restingPulse: round(calendarDay?.restingHr),
        spo2: round(mean((calendarDay?.spo2 ?? []).map((p) => p.v))),
        stress: round(calendarDay?.estimates.stress),
      },
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
      insights: insightsFor(state, now),
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
