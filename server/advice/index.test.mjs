import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE } from '../../src/storage';
import { aiAdviceRequest } from '../../src/state/ai-advice';
import { currentCycle } from '../../src/state/cycle';
import { reportMode } from '../../src/state/day';
import { demoState } from '../../src/state/demo';
import fn from './index.js';

const NOW = new Date(2026, 8, 25, 15, 0);
const GOOD = 'Шагов почти нет, а пульс держится выше покоя. Похоже на холостой ход без мышечной разрядки.';

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

  it('системный запрос: физиология и ночь как причина, без выдуманных дел, тавтологий и команд, до 130 символов', () => {
    const prompt = fn.SYSTEM_PROMPT;
    expect(prompt).toContain('current_time');
    expect(prompt).toContain('pulse — средний пульс');
    expect(prompt).toContain('previous_opinions');
    expect(prompt).toContain('не придумывай обстоятельства жизни');
    expect(prompt).toContain('холостой ход');
    expect(prompt).toContain('режим сбережения энергии');
    expect(prompt).toContain('ночь и вчерашний день — законная первопричина того, что происходит сегодня, в любое время суток');
    expect(prompt).toContain('активность нельзя объяснять самой активностью');
    expect(prompt).toContain('Ответ — ровно два коротких предложения, вместе не длиннее 130 символов');
    expect(prompt).toContain('никаких «сделайте», «попробуйте», «встаньте», «отдохните», «разомните»');
    expect(prompt).not.toMatch(/например|Пример|рабоч\S* дн/i);
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

  it('ответ: до 130 символов, два предложения, без команд, выдуманных дел, тавтологий, призывов поспать днём и повторов', () => {
    const good = GOOD;
    expect(good.length).toBeLessThanOrEqual(130);
    expect(fn.answerProblem(good)).toBeNull();
    // Ночь как причина днём — можно (владелец 26.09: единственный удачный ответ v7 был про это).
    expect(fn.answerProblem('Вы активны и спокойны. Возможно, немного устали из-за недостатка отдыха накануне.', [], '15:00')).toBeNull();
    expect(fn.answerProblem('К вечеру тонус заметно просел. Похоже, ночь была короче обычной, и запаса сил не хватило.', [], '18:00')).toBeNull();
    expect(fn.answerProblem('Движения мало, но сердце бьётся ровно и спокойно. Кажется, тело просто бережёт силы.')).toBeNull();
    expect(fn.answerProblem('Сердце работает ровно, а движения почти нет. Похоже, тело бережёт ресурс после короткой ночи.')).toBeNull();
    // Днём звать спать нельзя, вечером «ложитесь» — всё равно команда.
    expect(fn.answerProblem('Тело к обеду заметно замедлилось. Похоже, стоит немного поспать после такой ночи.', [], '14:00')).toBe('day_sleep');
    expect(fn.answerProblem('Тело к вечеру замедлилось. Ложитесь пораньше после такой ночи.', [], '21:00')).toBe('command');
    // Выдуманные обстоятельства жизни.
    expect(fn.answerProblem('Пульс весь день выше обычного. Похоже, сказывается загруженность делами.')).toBe('invented');
    expect(fn.answerProblem('Пульс весь день выше обычного. Кажется, работа сегодня не отпускает.')).toBe('invented');
    expect(fn.answerProblem('Пульс выше обычного с утра. Похоже, график сегодня плотный.')).toBe('invented');
    // Тавтология: движение объяснено движением.
    expect(fn.answerProblem('Вы сегодня мало активны. Возможно, это из-за недостатка движения.')).toBe('tautology');
    expect(fn.answerProblem('Шагов сегодня немного. Похоже, день выдался малоподвижным и сидячим.')).toBe('tautology');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Встаньте и пройдитесь до окна.')).toBe('command');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Попробуйте сменить позу.')).toBe('command');
    expect(fn.answerProblem('Похоже, вы устали к вечеру. Кажется, пульс держится выше покоя.')).toBe('horoscope');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Погладьте себя по голове.')).toBe('touchy');
    expect(fn.answerProblem('Весь день идёт на натянутом фоне. Сделайте пять глубоких вдохов.')).toBe('breathing');
    expect(fn.answerProblem('Шагов почти нет, а пульс выше покоя. Похоже, чашка кофе после 3 часов дала о себе знать.')).toBe('numbers');
    expect(fn.answerProblem('Фон натянутый. Движения мало. Похоже, кофе.')).toBe('sentences');
    expect(fn.answerProblem('Весь день идёт на ровном, но натянутом фоне. ' + 'Похоже, после короткой и неглубокой ночи тело весь день держится на внутреннем возбуждении без мышечной разрядки.')).toBe('long');
    expect(fn.answerProblem(good, ['Шагов почти нет, а пульс выше покоя. Похоже, холостой ход без мышечной разрядки.'])).toBe('repeat');
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
      { role: 'user', text: 'Ответ не подходит: никаких советов и команд — только наблюдение за телом и дружеская догадка о причине. Напиши заново по правилам — ровно два коротких предложения, до 130 символов: наблюдение за телом и догадка о физиологической причине.' },
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
