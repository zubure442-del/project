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
    expect(Object.keys(input)).toEqual(['current_time', 'person', 'days', 'today_by_hour', 'previously_suggested_actions']);
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

  it('системный запрос: без готовых действий, первое предложение — тренд датчиков, стоп-лист, до 130 символов', () => {
    const prompt = fn.SYSTEM_PROMPT;
    expect(prompt).toContain('current_time');
    expect(prompt).toContain('pulse — средний пульс');
    expect(prompt).toContain('Первое предложение — этот тренд словами о теле: какой датчик что показывает и за какое время');
    expect(prompt).toContain('эргономика позы и рабочего места, микроразминка кистей, шеи или плечевого пояса, смена зрительной дистанции, терморегуляция и свежий воздух, темп движения');
    expect(prompt).toContain('«вы устали», «вы напряжены», «вы сосредоточены»');
    expect(prompt).toContain('погладить, обнять себя, массировать лицо или щёки');
    expect(prompt).toContain('не длиннее 130 символов, ровно два предложения');
    // Готовых действий в повелительном наклонении, которые модель могла бы скопировать, нет.
    expect(prompt).not.toMatch(/опустите|посмотрите|выпейте|выпрямите|проветрите|сбавьте|например|Пример/i);
  });

  it('прежние советы — из недели приложения или, у старых сборок, из recent', async () => {
    const sample = await readSample();
    expect(fn.modelInput(sample).previously_suggested_actions).toEqual([
      'Лягте между 23:00 и 23:30, ночь пройдёт спокойнее.',
      'Сегодня поужинайте по графику Vuelo, в 18:45.',
    ]);
    const week = {
      ...sample,
      past_opinions: [
        { ago: 0, slot: 'morning', text: 'Утро идёт туговато. Выпейте стакан прохладной воды.' },
        { ago: 2, slot: 'evening', text: 'Плечи весь день у ушей. Опустите их вниз и задержите.' },
      ],
    };
    expect(fn.validate(week)).toBeNull();
    expect(fn.modelInput(week).previously_suggested_actions).toEqual(['Выпейте стакан прохладной воды.', 'Опустите их вниз и задержите.']);
    expect(fn.validate({ ...sample, past_opinions: [{ ago: 1, slot: 'night', text: 'x' }] })).toBe('past_opinions');
  });

  it('ответ: до 130 символов, два предложения, тренд датчиков, без гороскопа, прикосновений, дыхания, ночи днём и повторов', () => {
    const good = 'Уже пару часов почти нет шагов, а пульс держится выше покоя. Встаньте и прокрутите плечами назад, пока закипает чайник.';
    expect(good.length).toBeLessThanOrEqual(130);
    expect(fn.answerProblem(good)).toBeNull();
    expect(fn.answerProblem('Шагов с обеда почти нет. ' + 'Поставьте монитор на уровень глаз, отодвиньте его на вытянутую руку и проверьте, что стопы стоят на полу ровно.')).toBe('long');
    expect(fn.answerProblem('Вы устали и перегружены. Поставьте ноги ровно на пол.')).toBe('ring');
    expect(fn.answerProblem('Фон напряжения растёт — вы устали. Поставьте ноги ровно на пол.')).toBe('horoscope');
    expect(fn.answerProblem('Пульс держится выше покоя. Погладьте себя по голове.')).toBe('touchy');
    expect(fn.answerProblem('Пульс держится выше покоя. Сделайте пять глубоких вдохов.')).toBe('breathing');
    expect(fn.answerProblem('Пульс выше, чем после плохой ночи. Разомните кисти.', [], '17:00')).toBe('time');
    expect(fn.answerProblem('Пульс вырос на 12 ударов. Разомните кисти.')).toBe('numbers');
    expect(fn.answerProblem('Шагов нет. Встаньте. Прокрутите плечами.')).toBe('sentences');
    expect(fn.answerProblem(good, ['Встаньте и прокрутите плечами назад несколько раз.'])).toBe('repeat');
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
    const text = 'Уже пару часов почти нет шагов, а пульс держится выше покоя. Встаньте и прокрутите плечами назад, пока закипает чайник.';
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
    const good = 'Уже пару часов почти нет шагов, а пульс держится выше покоя. Встаньте и прокрутите плечами назад, пока закипает чайник.';
    const bodies = [];
    let answers = ['Пульс держится выше покоя. Сделайте пять глубоких вдохов.', good];
    vi.stubGlobal('fetch', async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return modelAnswer(answers.shift());
    });
    const res = await fn.handler(event(await readSample()), context);
    expect(JSON.parse(res.body).text).toBe(good);
    expect(bodies[1].messages.slice(-2)).toEqual([
      { role: 'assistant', text: 'Пульс держится выше покоя. Сделайте пять глубоких вдохов.' },
      { role: 'user', text: 'Ответ не подходит: дыхательные упражнения запрещены — предложи другое простое действие. Напиши заново по правилам — ровно два предложения, до 130 символов.' },
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
