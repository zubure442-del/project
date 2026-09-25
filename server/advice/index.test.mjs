import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE } from '../../src/storage';
import { aiAdviceRequest } from '../../src/state/ai-advice';
import { currentCycle } from '../../src/state/cycle';
import { reportMode } from '../../src/state/day';
import { demoState } from '../../src/state/demo';
import fn from './index.js';

const NOW = new Date(2026, 8, 25, 15, 0);

/** Запрос ровно такой, какой шлёт приложение. */
function appPayload() {
  const built = { ...demoState(EMPTY_STATE, 7, NOW), demo: undefined };
  const cycle = currentCycle(built);
  const state = {
    ...built,
    profile: { ...built.profile, goal: 'keep' },
    reports: [{ date: cycle.date, mode: reportMode(NOW), templateId: 'd-act-mid-1', text: 'Шаги пока набираются.' }],
  };
  return aiAdviceRequest(state, NOW).payload;
}

const event = (payload, key = 'secret') => ({
  httpMethod: 'POST',
  headers: { 'X-Vuelo-Key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  isBase64Encoded: false,
});
const context = { token: { access_token: 'iam-token' } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('СИНТЕТИЧЕСКИЕ: облачная функция «Мнения Лиса»', () => {
  it('запрос приложения проходит проверку функции; текст для модели — словами, без «из 100»', () => {
    const payload = appPayload();
    expect(fn.validate(payload)).toBeNull();
    const text = fn.buildUserText(payload);
    expect(text).toContain('Время суток: день');
    expect(text).toContain('Цель пользователя: поддерживать форму');
    expect(text).not.toMatch(/из 100/);
  });

  it('без ключа приложения — 403, кривой запрос — 400', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    expect((await fn.handler(event(appPayload(), 'wrong'), context)).statusCode).toBe(403);
    expect((await fn.handler(event({ ...appPayload(), mode: 'night' }), context)).statusCode).toBe(400);
  });

  it('ходит в YandexGPT от имени сервисного аккаунта, логирование у Яндекса выключено, отдаёт текст', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ result: { alternatives: [{ message: { role: 'assistant', text: ' Хороший день для прогулки. ' } }] } }),
        { status: 200 },
      );
    });
    const res = await fn.handler(event(appPayload()), context);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ text: 'Хороший день для прогулки.' });
    const sent = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://llm.api.cloud.yandex.net/foundationModels/v1/completion');
    expect(calls[0].init.headers.Authorization).toBe('Bearer iam-token');
    expect(calls[0].init.headers['x-data-logging-enabled']).toBe('false');
    expect(sent.modelUri).toBe('gpt://b1gfolder/yandexgpt/latest');
    expect(sent.messages[0].role).toBe('system');
  });

  it('модель недоступна — 502, приложение оставит шаблонный совет', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    vi.stubGlobal('fetch', async () => new Response('{"error":"Permission denied"}', { status: 403 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await fn.handler(event(appPayload()), context)).statusCode).toBe(502);
  });
});
