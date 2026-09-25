import { describe, expect, it } from 'vitest';
import { AI_TEMPLATE_ID } from '../domain';
import { EMPTY_STATE, type VueloState } from '../storage';
import { emptySyncResult } from '../ble/sync';
import { aiAdviceRequest, fetchAiAdvice, withAiAdvice } from './ai-advice';
import { currentCycle } from './cycle';
import { reportMode } from './day';
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
    profile: { name: 'Анна', sex: 'male', heightCm: 180, weightKg: 82, birthYear: 1990, goal: 'lose' },
    reports: [
      { date: '2026-09-24', mode: 'evening', templateId: 'e-good-1', text: 'День получился сбалансированным.' },
      { date: cycle.date, mode: reportMode(NOW), templateId: 'd-act-mid-1', text: 'Шаги пока набираются.' },
    ],
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
    // Сон с временем засыпания и подъёма, замеры «Организма» и план дня из карточек.
    expect(p.sleep.asleep).toMatch(/^\d\d:\d\d$/);
    expect(p.sleep.minutes).toBeGreaterThan(0);
    expect(p.organism.hrv).not.toBeNull();
    expect(p.plan.workout?.title).toBeTruthy();
    expect(p.plan.bedtime?.from).toMatch(/^\d\d:\d\d$/);
    expect(p.plan.meals.length).toBeGreaterThan(0);
    // Наблюдения дня — строки для догадки Лиса (в демо-неделе их может и не быть).
    expect(Array.isArray(p.insights)).toBe(true);
    // Значений глюкозы и давления в запросе нет: о еде Лис говорит через привычки.
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
