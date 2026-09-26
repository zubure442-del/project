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
  it('запрос приложения проходит проверку; модели уходит сырой JSON рядов без выводов и связок', () => {
    const payload = appPayload();
    expect(fn.validate(payload)).toBeNull();
    const input = fn.modelInput(payload);
    expect(Object.keys(input)).toEqual(['now', 'person', 'days', 'today_by_hour', 'previous_opinions', 'previously_suggested_actions']);
    expect(input.person).toEqual({ sex: 'женщина', age: 32, height_cm: 168, weight_kg: 60, goal: 'поддерживать форму' });
    expect(Object.keys(input.days[0])).toEqual([
      'ago', 'asleep', 'awake', 'sleep_min', 'deep_min', 'night_pulse', 'hrv_ms', 'resting_pulse', 'spo2', 'day_stress',
      'steps', 'step_norm', 'active_kcal', 'training_load', 'workout', 'meal_times',
    ]);
    // Дни по порядку: от старых к сегодня; сегодняшний стресс по часам тоже уходит.
    expect(input.days.map((d) => d.ago)).toEqual([...input.days.map((d) => d.ago)].sort((a, b) => b - a));
    expect(input.today_by_hour.stress).toHaveLength(input.today_by_hour.steps.length);
    expect(JSON.stringify(input)).not.toMatch(/Анна|давлен|glucose|systolic/);
  });

  it('системный запрос: только ход рассуждения — без связок «показатель → действие» и без примеров', () => {
    const prompt = fn.SYSTEM_PROMPT;
    expect(prompt).toContain('previously_suggested_actions');
    expect(prompt).toContain('расхождения между рядами');
    expect(prompt).toContain('зайди через другой физиологический рычаг');
    expect(prompt).toContain('проприоцепцию, сенсорные триггеры, чередование фаз напряжения и расслабления, положение и опору тела, температурный режим');
    expect(prompt).toContain('капитанские бытовые советы: погулять, пройтись, отдохнуть, выпить воды, подышать');
    expect(prompt).toContain('Ответ — ровно два предложения');
    // Ни примеров ответа, ни готовых связок.
    expect(prompt).not.toMatch(/Пример|Например|например|Лис: |→/);
    expect(prompt).not.toMatch(/если [а-яё ]*(выше|ниже|упал|вырос)/i);
  });

  it('прежние мнения и уже предложенные действия — из недели приложения или, у старых сборок, из recent', async () => {
    const sample = await readSample();
    expect(fn.modelInput(sample).previously_suggested_actions).toEqual([
      'Лягте между 23:00 и 23:30, ночь пройдёт спокойнее.',
      'Сегодня поужинайте по графику Vuelo, в 18:45.',
    ]);
    const week = {
      ...sample,
      past_opinions: [
        { ago: 0, slot: 'morning', text: 'Похоже, тело ещё держит вчерашний тонус. Сожмите кулаки на пять секунд и резко отпустите три раза.' },
        { ago: 2, slot: 'evening', text: 'Кажется, вечер не отпускает плечи. Прижмите лопатки к спинке стула и медленно отпустите.' },
      ],
    };
    expect(fn.validate(week)).toBeNull();
    const input = fn.modelInput(week);
    expect(input.previous_opinions[1]).toEqual({ when: '2 дн. назад вечером', text: week.past_opinions[1].text });
    expect(input.previously_suggested_actions).toEqual([
      'Сожмите кулаки на пять секунд и резко отпустите три раза.',
      'Прижмите лопатки к спинке стула и медленно отпустите.',
    ]);
    expect(fn.validate({ ...sample, past_opinions: [{ ago: 1, slot: 'night', text: 'x' }] })).toBe('past_opinions');
  });

  it('ответ: ровно два предложения, в первом без цифр, без банальностей, запретных слов и повторов', () => {
    const good = 'Похоже, напряжение с обеда осело в мышцах шеи, а тело так и не получило сигнала к разрядке. Упритесь ладонями в край стола, пять секунд давите изо всех сил, затем резко отпустите.';
    expect(fn.answerProblem(good)).toBeNull();
    expect(fn.answerProblem('Похоже, день тяжёлый. Прогуляйтесь десять минут на свежем воздухе.')).toBe('banal');
    expect(fn.answerProblem('Кажется, вы устали за день и тело просит паузы. Отдохните немного и выпейте воды.')).toBe('banal');
    expect(fn.answerProblem('Похоже, тело перегрелось за день и не может остыть. Подышите глубоко пару минут.')).toBe('banal');
    expect(fn.answerProblem('Похоже, стресс вырос на 20 пунктов. Упритесь ладонями в стол и резко отпустите.')).toBe('numbers');
    expect(fn.answerProblem('Похоже, сахар скачет после еды весь день. Упритесь ладонями в стол и резко отпустите.')).toBe('forbidden');
    expect(fn.answerProblem('Похоже, тело зажато. Упритесь ладонями в стол. Потом резко отпустите руки.')).toBe('sentences');
    expect(fn.answerProblem(good, ['Упритесь ладонями в край стола на пять секунд и резко отпустите.'])).toBe('repeat');
    expect(fn.answerProblem(good, ['Прижмите лопатки к спинке стула и медленно отпустите.'])).toBeNull();
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
    const text = 'Похоже, после обеда тело держит скрытое напряжение, а движения не хватает, чтобы его сбросить. Встаньте, перенесите вес на пятки и десять раз медленно поднимитесь на носки.';
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
    const good = 'Похоже, напряжение с обеда осело в мышцах шеи, а тело так и не получило сигнала к разрядке. Упритесь ладонями в край стола, пять секунд давите изо всех сил, затем резко отпустите.';
    const bodies = [];
    let answers = ['Похоже, день тяжёлый. Прогуляйтесь десять минут.', good];
    vi.stubGlobal('fetch', async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return modelAnswer(answers.shift());
    });
    const res = await fn.handler(event(await readSample()), context);
    expect(JSON.parse(res.body).text).toBe(good);
    expect(bodies[1].messages.slice(-2)).toEqual([
      { role: 'assistant', text: 'Похоже, день тяжёлый. Прогуляйтесь десять минут.' },
      { role: 'user', text: 'Ответ не подходит: совет банальный — нужен прикладной микро-приём из физиологии, нейробиологии или эргономики. Напиши заново по правилам — ровно два предложения.' },
    ]);

    answers = ['Отдохните.', 'Попейте воды и отдохните.'];
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
