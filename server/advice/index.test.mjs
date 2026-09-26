import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE } from '../../src/storage';
import { aiAdviceRequest } from '../../src/state/ai-advice';
import { currentCycle } from '../../src/state/cycle';
import { reportMode } from '../../src/state/day';
import { demoState } from '../../src/state/demo';
import fn from './index.js';

const NOW = new Date(2026, 8, 25, 15, 0);
const GOOD = 'Весь день идёт на ровном, но натянутом фоне. Похоже, накопилось от долгой неподвижности за работой.';

/** Запрос ровно такой, какой шлёт приложение. */
function appPayload() {
  const built = { ...demoState(EMPTY_STATE, 7, NOW), demo: undefined };
  const cycle = currentCycle(built);
  const state = {
    ...built,
    lastSyncAt: NOW.getTime(),
    profile: { name: 'Анна', sex: 'female', heightCm: 168, weightKg: 60, birthYear: 1994, goal: 'keep' },
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
const modelAnswer = (text) =>
  new Response(JSON.stringify({ result: { alternatives: [{ message: { role: 'assistant', text } }] } }), { status: 200 });

async function readSample() {
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('СИНТЕТИЧЕСКИЕ: облачная функция «Мнения Лиса»', () => {
  it('запрос приложения проходит проверку; модели уходит время, ряды и пульс, шаги и стресс сегодня по часам', () => {
    const payload = appPayload();
    expect(fn.validate(payload)).toBeNull();
    const input = fn.modelInput(payload);
    expect(Object.keys(input)).toEqual(['current_time', 'person', 'days', 'today_by_hour', 'previous_opinions']);
    expect(input.current_time).toBe('15:00');
    expect(input.person).toEqual({ sex: 'женщина', age: 32, goal: 'поддерживать форму' });
    expect(Object.keys(input.days[0])).toEqual([
      'ago', 'asleep', 'awake', 'sleep_min', 'deep_min', 'night_pulse', 'resting_pulse', 'hrv_ms', 'day_stress', 'steps', 'step_norm', 'workout', 'meal_times',
    ]);
    expect(input.days.map((d) => d.ago)).toEqual([...input.days.map((d) => d.ago)].sort((a, b) => b - a));
    const h = input.today_by_hour;
    expect(Object.keys(h)).toEqual(['from_hour', 'steps', 'stress', 'pulse']);
    expect(h.pulse).toHaveLength(h.steps.length);
    expect(h.pulse.some((v) => v !== null)).toBe(true);
    expect(JSON.stringify(input)).not.toMatch(/Анна|давлен|glucose|systolic/);
    expect(fn.validate({ ...payload, hours: { ...payload.hours, pulse: [500] } })).toBe('hours');
  });

  it('системный запрос: картина и причина, без команд, стоп-лист, до 130 символов', () => {
    const prompt = fn.SYSTEM_PROMPT;
    expect(prompt).toContain('current_time');
    expect(prompt).toContain('pulse — средний пульс');
    expect(prompt).toContain('previous_opinions');
    expect(prompt).toContain('Ищи первопричину, а не отдельное отклонение');
    expect(prompt).toContain('Ответ — ровно два коротких предложения, вместе не длиннее 130 символов');
    expect(prompt).toContain('Твоё дружеское предположение о причине этой картины');
    expect(prompt).toContain('никаких «сделайте», «попробуйте», «встаньте», «отдохните», «разомните»');
    expect(prompt).toContain('ярлыки вроде «вы устали» или «вы напряжены»');
    // Готовых фраз, которые модель могла бы скопировать, нет.
    expect(prompt).not.toMatch(/например|Пример/i);
  });

  it('прежние мнения — из недели приложения или, у старых сборок, из recent', async () => {
    const sample = await readSample();
    expect(fn.modelInput(sample).previous_opinions).toEqual([
      'День вышел насыщенным, но вечер затянулся. Лягте между 23:00 и 23:30, ночь пройдёт спокойнее.',
      'Похоже, поздний ужин снова затянул вечер, и ночью телу было не до отдыха. Сегодня поужинайте по графику Vuelo, в 18:45.',
    ]);
    const week = {
      ...sample,
      past_opinions: [
        { ago: 0, slot: 'morning', text: 'Утро идёт туговато. Похоже, ночь вышла короче обычного.' },
        { ago: 2, slot: 'evening', text: 'Вечер прошёл на взводе. Кажется, день был почти без движения.' },
      ],
    };
    expect(fn.validate(week)).toBeNull();
    expect(fn.modelInput(week).previous_opinions).toEqual([
      'Утро идёт туговато. Похоже, ночь вышла короче обычного.',
      'Вечер прошёл на взводе. Кажется, день был почти без движения.',
    ]);
    expect(fn.validate({ ...sample, past_opinions: [{ ago: 1, slot: 'night', text: 'x' }] })).toBe('past_opinions');
  });

  it('ответ: до 130 символов, два предложения, без команд, цифр, ярлыков, прикосновений, дыхания, ночи днём и повторов', () => {
    const good = GOOD;
    expect(good.length).toBeLessThanOrEqual(130);
    expect(fn.answerProblem(good)).toBeNull();
    expect(fn.answerProblem('После обеда тело будто притихло и держится настороже. Кажется, долгое сидение за столом копит напряжение.')).toBeNull();
    expect(fn.answerProblem('Весь день идёт на ровном, но натянутом фоне. ' + 'Похоже, всё копилось от долгой неподвижности за работой, поздних созвонов и того, что обед снова съехал на вечер.')).toBe('long');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Встаньте и пройдитесь до окна.')).toBe('command');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Попробуйте сменить позу.')).toBe('command');
    expect(fn.answerProblem('Похоже, вы устали к вечеру. Кажется, день был без движения.')).toBe('horoscope');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Погладьте себя по голове.')).toBe('touchy');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Сделайте пять глубоких вдохов.')).toBe('breathing');
    expect(fn.answerProblem('День идёт тяжеловато. Похоже, после плохой ночи тело не догнало.', [], '17:00')).toBe('time');
    expect(fn.answerProblem('Уже 3 часа почти без движения. Похоже, работа затянула.')).toBe('numbers');
    expect(fn.answerProblem('Фон натянутый. Движения мало. Похоже, работа.')).toBe('sentences');
    expect(fn.answerProblem(good, ['Весь день идёт на ровном, но натянутом фоне. Похоже, накопилось от неподвижности за работой.'])).toBe('repeat');
    expect(fn.cleanAnswer('Лис: «' + good + '»')).toBe(good);
  });

  it('лишние или кривые поля не пропускаем', () => {
    const payload = appPayload();
    expect(fn.validate({ ...payload, time: '25 часов' })).toBe('time');
    expect(fn.validate({ ...payload, profile: { ...payload.profile, age: 500 } })).toBe('profile');
    expect(fn.validate({ ...payload, days: [{ ...payload.days[0], meals: ['после обеда'] }] })).toBe('days');
    expect(fn.validate({ ...payload, hours: { ...payload.hours, stress: [1] } })).toBe('hours');
  });

  it('без ключа приложения — 403, кривой запрос — 400', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    expect((await fn.handler(event(appPayload(), 'wrong'), context)).statusCode).toBe(403);
    expect((await fn.handler(event({ ...appPayload(), mode: 'night' }), context)).statusCode).toBe(400);
  });

  it('ходит в YandexGPT от имени сервисного аккаунта с системным запросом и сырым JSON; ответ — с версией', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    const calls = [];
    const text = GOOD;
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return modelAnswer(text);
    });
    const sample = await readSample();
    const res = await fn.handler(event(sample), context);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ text, mode: 'free', v: fn.VERSION });
    const sent = JSON.parse(calls[0].init.body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://llm.api.cloud.yandex.net/foundationModels/v1/completion');
    expect(calls[0].init.headers.Authorization).toBe('Bearer iam-token');
    expect(calls[0].init.headers['x-data-logging-enabled']).toBe('false');
    expect(sent.modelUri).toBe('gpt://b1gfolder/yandexgpt/latest');
    expect(sent.messages[0]).toEqual({ role: 'system', text: fn.SYSTEM_PROMPT });
    expect(JSON.parse(sent.messages[1].text)).toEqual(fn.modelInput(sample));
  });

  it('ответ не прошёл проверку — один повтор с причиной; и он мимо — 502, в приложении шаблон', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const good = GOOD;
    const bodies = [];
    let answers = ['Весь день идёт на натянутом фоне. Встаньте и пройдитесь до окна.', good];
    vi.stubGlobal('fetch', async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return modelAnswer(answers.shift());
    });
    const res = await fn.handler(event(await readSample()), context);
    expect(JSON.parse(res.body).text).toBe(good);
    expect(bodies[1].messages.slice(-2)).toEqual([
      { role: 'assistant', text: 'Весь день идёт на натянутом фоне. Встаньте и пройдитесь до окна.' },
      { role: 'user', text: 'Ответ не подходит: никаких советов и команд — только картина состояния и дружеское предположение о причине. Напиши заново по правилам — ровно два коротких предложения, до 130 символов: картина состояния и предположение о причине.' },
    ]);

    answers = ['Отдохните.', 'Подышите.'];
    const again = await fn.handler(event(await readSample()), context);
    expect(again.statusCode).toBe(502);
  });

  it('модель недоступна — 502, приложение оставит шаблонный совет', async () => {
    vi.stubEnv('APP_KEY', 'secret');
    vi.stubEnv('FOLDER_ID', 'b1gfolder');
    vi.stubGlobal('fetch', async () => new Response('{"error":"Permission denied"}', { status: 403 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await fn.handler(event(appPayload()), context)).statusCode).toBe(502);
  });
});
