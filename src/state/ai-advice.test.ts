import { describe, expect, it } from 'vitest';
import { AI_TEMPLATE_ID } from '../domain';
import { EMPTY_STATE, type VueloState } from '../storage';
import { emptySyncResult } from '../ble/sync';
import { AI_ADVICE_RETRY_MS, aiAdviceDue, aiAdviceKey, aiAdviceRequest, fetchAiAdvice, withAiAdvice } from './ai-advice';
import { currentCycle } from './cycle';
import { adviceFor, adviceModeNow, coffeeInput } from './day';
import { sleepModeFor } from './sleep-mode';
import { demoState } from './demo';
import { applySyncResult } from './sync-plan';

/** 25.09.2026 15:00 — дневной совет по текущему циклу. */
const NOW = new Date(2026, 8, 25, 15, 0);

/** Настоящее (не демо) состояние с текущим циклом с итогом и шаблонным советом на него. */
function stateWithTemplate(): VueloState {
  const built: VueloState = { ...demoState(EMPTY_STATE, 7, NOW), demo: undefined };
  const cycle = currentCycle(built)!;
  expect(cycle.total).not.toBeNull();
  return {
    ...built,
    lastSyncAt: NOW.getTime(),
    profile: { name: 'Анна', sex: 'male', heightCm: 180, weightKg: 82, birthYear: 1990, goal: 'lose' },
    reports: [
      { date: '2026-09-24', mode: 'evening', templateId: 'e-good-1', text: 'День получился сбалансированным.' },
      { date: cycle.date, mode: adviceModeNow(built, NOW), templateId: 'd-act-mid-1', text: 'Шаги пока набираются.' },
    ],
  };
}

/** Подъём текущего цикла и начало окна сна — минуты от полуночи даты цикла; `when` — время по этим минутам. */
function rhythm(state: VueloState, now = NOW) {
  const cycle = currentCycle(state)!;
  const [y, m, d] = cycle.date.split('-').map(Number);
  return {
    when: (minute: number) => new Date(y, m - 1, d, 0, minute),
    wake: coffeeInput(state, now)!.wakeMinute,
    bed: sleepModeFor(state, now)!.from,
  };
}

const okFetch = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const CONFIG = { url: 'https://example.test/advice', key: 'k' };

describe('СИНТЕТИЧЕСКИЕ: «Мнение Лиса» от YandexGPT', () => {
  it('просим совет на текущий цикл и время суток; уходит всё о дне, кроме имени', () => {
    const state = stateWithTemplate();
    const request = aiAdviceRequest(state, NOW)!;
    const p = request.payload;
    expect(request.mode).toBe('day');
    expect(request.templateId).toBe('d-act-mid-1');
    expect(p.time).toBe('15:00');
    expect(p.profile).toEqual({ sex: 'male', age: 36, heightCm: 180, weightKg: 82, goal: 'lose' });
    expect(p.recent).toEqual(['День получился сбалансированным.']);
    expect(JSON.stringify(p)).not.toContain('Анна');
    // Таблица чисел по дням: неделя до сегодня и сегодня; шаги сегодня по часам.
    expect(p.days.at(-1)?.ago).toBe(0);
    expect(p.days.length).toBeGreaterThan(5);
    expect(p.days.at(-1)?.asleep).toMatch(/^\d\d:\d\d$/);
    expect(p.hours?.steps.length).toBeGreaterThan(0);
    expect(p.scores.total).not.toBeNull();
    expect(p.plan.workout?.title).toBeTruthy();
    expect(p.plan.bedtime?.from).toMatch(/^\d\d:\d\d$/);
    // Значений глюкозы и давления в запросе нет — только время подъёмов глюкозы (еда).
    expect(JSON.stringify(p)).not.toMatch(/glucose|systolic|diastolic/);
  });

  it('совет от модели заменяет шаблонный и больше не запрашивается; в демо не просим', () => {
    const state = stateWithTemplate();
    const request = aiAdviceRequest(state, NOW)!;
    const next = withAiAdvice(state, request, 'Сегодня хороший день для прогулки после обеда.');
    const stored = next.reports.find((r) => r.date === request.date && r.mode === 'day')!;
    expect(stored.templateId).toBe(AI_TEMPLATE_ID);
    expect(aiAdviceRequest(next, NOW)).toBeNull();
    expect(aiAdviceRequest({ ...state, demo: true }, NOW)).toBeNull();
  });

  it('следующая выгрузка совет от модели шаблоном не затирает', () => {
    const state = stateWithTemplate();
    const request = aiAdviceRequest(state, NOW)!;
    const next = withAiAdvice(state, request, 'Сегодня хороший день для прогулки после обеда.');
    const after = applySyncResult(next, emptySyncResult(), null, NOW);
    const stored = after.reports.find((r) => r.date === request.date && r.mode === 'day')!;
    expect(stored.text).toBe('Сегодня хороший день для прогулки после обеда.');
  });

  it('пока ждали ответа, шаблонный совет сменился — ответ не применяем', () => {
    const state = stateWithTemplate();
    const request = aiAdviceRequest(state, NOW)!;
    const changed = {
      ...state,
      reports: state.reports.map((r) => (r.templateId === 'd-act-mid-1' ? { ...r, templateId: 'd-act-low-1' } : r)),
    };
    expect(withAiAdvice(changed, request, 'Сегодня хороший день для прогулки после обеда.')).toBe(changed);
  });

  it('три отрезка за цикл — по подъёму этого цикла и окну «Режима сна», а не по часам', () => {
    const state = stateWithTemplate();
    const { when, wake, bed } = rhythm(state);
    expect(wake + 300).toBeLessThan(bed - 180);
    expect(adviceModeNow(state, when(wake + 30))).toBe('morning');
    expect(adviceModeNow(state, when(wake + 300))).toBe('day');
    expect(adviceModeNow(state, when(bed - 60))).toBe('evening');
  });

  it('отрезок сменился между выгрузками: шаблона в истории ещё нет — мнение всё равно просим и записываем', () => {
    const state = stateWithTemplate();
    const { when, bed } = rhythm(state);
    const evening = when(bed - 60);
    const request = aiAdviceRequest(state, evening)!;
    expect([request.mode, request.templateId]).toEqual(['evening', null]);
    const next = withAiAdvice(state, request, 'Похоже, день вышел долгим. Сегодня лягте в окно Vuelo.');
    const stored = next.reports.find((r) => r.date === request.date && r.mode === 'evening')!;
    expect(stored.templateId).toBe(AI_TEMPLATE_ID);
    expect(adviceFor(next, evening)?.text).toBe('Похоже, день вышел долгим. Сегодня лягте в окно Vuelo.');
    // Пока ждали ответа, выгрузка записала на вечер шаблон — мнение модели всё равно его заменяет.
    const withTemplate = { ...state, reports: [...state.reports, { date: request.date, mode: 'evening' as const, templateId: 'e-good-1', text: 'Шаблон.' }] };
    expect(withAiAdvice(withTemplate, request, 'Похоже, день вышел долгим. Сегодня лягте в окно Vuelo.')).not.toBe(withTemplate);
    // Дневное мнение осталось своим, на вечер больше не просим.
    expect(next.reports.find((r) => r.date === request.date && r.mode === 'day')?.templateId).toBe('d-act-mid-1');
    expect(aiAdviceRequest(next, evening)).toBeNull();
  });

  it('выгрузка пишет шаблон своего отрезка: в 18:30 до окна сна ещё далеко — «днём», а не «вечер» по часам', () => {
    const evening = new Date(2026, 8, 25, 18, 30);
    const built: VueloState = { ...demoState(EMPTY_STATE, 7, evening), demo: undefined, reports: [] };
    const { bed } = rhythm(built, evening);
    expect(bed - 180).toBeGreaterThan(18 * 60 + 30);
    const after = applySyncResult(built, emptySyncResult(), null, evening);
    const cycle = currentCycle(after)!;
    expect(after.reports.filter((r) => r.date === cycle.date).map((r) => r.mode)).toEqual(['day']);
  });

  it('неудачный запрос на тот же отрезок повторяем не раньше чем через 30 минут', () => {
    expect(aiAdviceKey({ date: '2026-09-25', mode: 'evening' })).toBe('2026-09-25 evening');
    expect(aiAdviceDue(undefined, 0)).toBe(true);
    expect(aiAdviceDue(0, AI_ADVICE_RETRY_MS - 1)).toBe(false);
    expect(aiAdviceDue(0, AI_ADVICE_RETRY_MS)).toBe(true);
  });

  it('ответ посредника: хороший текст — берём; ошибка, пустой ответ, запретный текст, нет сети — шаблон', async () => {
    const payload = aiAdviceRequest(stateWithTemplate(), NOW)!.payload;
    expect(await fetchAiAdvice(payload, CONFIG, okFetch({ text: ' Сегодня хороший день для прогулки после обеда. ' }))).toEqual({
      text: 'Сегодня хороший день для прогулки после обеда.',
    });
    expect(await fetchAiAdvice(payload, CONFIG, okFetch({ error: 'x' }, 502))).toHaveProperty('error');
    expect(await fetchAiAdvice(payload, CONFIG, okFetch({}))).toHaveProperty('error');
    expect(await fetchAiAdvice(payload, CONFIG, okFetch({ text: 'Сходите к врачу, это важно для вашего здоровья.' }))).toHaveProperty('error');
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    expect(await fetchAiAdvice(payload, CONFIG, offline)).toHaveProperty('error');
  });
});
