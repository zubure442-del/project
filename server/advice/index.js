'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT.
 *
 * Приложение присылает обезличенные числа дня (без имени, возраста, веса и роста), функция
 * пишет из них запрос к модели по правилам продукта и возвращает { text } — «Мнение Лиса».
 * Ключей API здесь нет: функция ходит в YandexGPT от имени своего сервисного аккаунта
 * (роль ai.languageModels.user), токен выдаёт сама платформа (context.token).
 * Яндексу передаётся x-data-logging-enabled: false — запросы не сохраняются у него для обучения.
 * Сама функция ничего не хранит и тело запроса в лог не пишет.
 *
 * Переменные окружения функции:
 *   FOLDER_ID — идентификатор каталога Yandex Cloud;
 *   APP_KEY   — тот же ключ, что EXPO_PUBLIC_ADVICE_KEY в приложении: без него функция отвечает 403;
 *   MODEL     — необязательно: yandexgpt (по умолчанию, YandexGPT Pro), yandexgpt-lite или aliceai-llm.
 * Среда выполнения — Node.js 22 (fetch встроен), точка входа — index.handler.
 */

const { Buffer } = require('node:buffer');

const API_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
const MAX_BODY_CHARS = 4000;
const LLM_TIMEOUT_MS = 12000;

const MODE_TEXT = {
  morning: 'утро — говори о прошедшей ночи и о том, как начать день',
  day: 'день — говори о том, что происходит сейчас и что ещё можно успеть сегодня',
  evening: 'вечер — подведи итог дня и подскажи, как его спокойно завершить',
};
const GOAL_TEXT = { lose: 'снизить вес', keep: 'поддерживать форму', gain: 'набрать мышечную массу' };
const PART_TEXT = { sleep: 'сон', activity: 'активность', state: 'организм (восстановление по замерам кольца)' };

const SYSTEM_PROMPT = [
  'Ты — Лис, дружелюбный помощник приложения к умному кольцу. По показателям дня пользователя ты пишешь короткое мнение с одним советом.',
  'Правила:',
  '- По-русски, на «вы», тёплым спокойным тоном. 2–3 коротких предложения, не больше 280 символов.',
  '- Опирайся на самую слабую составляющую дня, если она указана; если всё хорошо — коротко поддержи.',
  '- Дай один конкретный и простой совет на сегодня: прогулка, лечь пораньше, спокойный темп, вода, перерыв.',
  '- Учитывай цель пользователя, но не дави.',
  '- Никаких медицинских утверждений: не называй болезни и диагнозы, не упоминай лекарства, лечение и врачей, не обещай результата.',
  '- Не пиши про глюкозу, сахар в крови и давление.',
  '- Не называй оценки числами «из 100» и не объясняй, как они считаются.',
  '- Не упоминай другие приложения, бренды и компании, не называй себя моделью.',
  '- Без эмодзи, списков, заголовков, кавычек и разметки. Не повторяй недавние советы.',
].join('\n');

const isScore = (v) => v === null || (typeof v === 'number' && v >= 0 && v <= 100);
const isCount = (v, max) => v === null || (typeof v === 'number' && v >= 0 && v <= max);

/** Проверка тела запроса: только ожидаемые поля и разумные значения. Возвращает причину отказа или null. */
function validate(p) {
  if (!p || typeof p !== 'object') return 'body';
  if (!Object.prototype.hasOwnProperty.call(MODE_TEXT, p.mode)) return 'mode';
  if (p.goal !== null && !Object.prototype.hasOwnProperty.call(GOAL_TEXT, p.goal)) return 'goal';
  if (p.weakest !== null && !Object.prototype.hasOwnProperty.call(PART_TEXT, p.weakest)) return 'weakest';
  if (!isScore(p.total)) return 'total';
  if (!p.sleep || !isScore(p.sleep.score) || !isCount(p.sleep.minutes, 1440) || !isCount(p.sleep.deepMinutes, 1440)) {
    return 'sleep';
  }
  if (!p.activity || !isScore(p.activity.score) || !isCount(p.activity.steps, 200000) || !isCount(p.activity.norm, 50000)) {
    return 'activity';
  }
  if (!p.organism || !isScore(p.organism.score)) return 'organism';
  if (!Array.isArray(p.recent) || p.recent.length > 5 || p.recent.some((t) => typeof t !== 'string' || t.length > 400)) {
    return 'recent';
  }
  return null;
}

const duration = (min) => `${Math.floor(min / 60)} ч ${String(Math.round(min % 60)).padStart(2, '0')} мин`;
/** Оценка словами: модели так проще, и чисел «из 100» в ответе не будет. */
const level = (score) =>
  score === null ? 'нет данных' : score >= 80 ? 'хорошо' : score >= 60 ? 'средне' : score >= 40 ? 'ниже обычного' : 'низко';

/** Показатели дня текстом для модели. */
function buildUserText(p) {
  const lines = [
    `Время суток: ${MODE_TEXT[p.mode]}.`,
    `Цель пользователя: ${p.goal ? GOAL_TEXT[p.goal] : 'не указана'}.`,
    `День в целом: ${level(p.total)}.`,
    `Сон: ${level(p.sleep.score)}` +
      (p.sleep.minutes !== null ? `, спал ${duration(p.sleep.minutes)}` : '') +
      (p.sleep.deepMinutes !== null ? `, из них глубокий сон ${duration(p.sleep.deepMinutes)}` : '') +
      '.',
    `Активность: ${level(p.activity.score)}` +
      (p.activity.steps !== null ? `, шагов ${p.activity.steps}` : '') +
      (p.activity.norm !== null ? ` при личной норме ${p.activity.norm}` : '') +
      '.',
    `Организм: ${level(p.organism.score)}.`,
    `Самая слабая составляющая: ${p.weakest ? PART_TEXT[p.weakest] : 'нет, всё хорошо'}.`,
  ];
  if (p.recent.length) lines.push(`Недавние советы (не повторяй их): ${p.recent.map((t) => `— ${t}`).join(' ')}`);
  return lines.join('\n');
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const header = (event, name) => {
  const headers = (event && event.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

async function handler(event, context) {
  if (event.httpMethod && event.httpMethod !== 'POST') return reply(405, { error: 'method' });
  const appKey = process.env.APP_KEY;
  if (!appKey || header(event, 'x-vuelo-key') !== appKey) return reply(403, { error: 'forbidden' });

  let body = event.body || '';
  if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  if (body.length > MAX_BODY_CHARS) return reply(413, { error: 'too large' });
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, { error: 'json' });
  }
  const problem = validate(payload);
  if (problem) return reply(400, { error: problem });

  const token = context && context.token && context.token.access_token;
  const folder = process.env.FOLDER_ID;
  if (!token || !folder) return reply(500, { error: 'service account or FOLDER_ID is not set' });
  const model = process.env.MODEL || 'yandexgpt';

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-folder-id': folder,
        'x-data-logging-enabled': 'false',
      },
      body: JSON.stringify({
        modelUri: `gpt://${folder}/${model}/latest`,
        completionOptions: { stream: false, temperature: 0.5, maxTokens: '300' },
        messages: [
          { role: 'system', text: SYSTEM_PROMPT },
          { role: 'user', text: buildUserText(payload) },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (e) {
    return reply(504, { error: `llm unreachable: ${e && e.name}` });
  }
  if (!response.ok) {
    // Текст ошибки Яндекса — в лог функции (без данных пользователя): по нему видно, что не так с доступом.
    console.error('llm error', response.status, (await response.text()).slice(0, 500));
    return reply(502, { error: `llm ${response.status}` });
  }
  const data = await response.json();
  const alt = data && data.result && data.result.alternatives && data.result.alternatives[0];
  const text = alt && alt.message && typeof alt.message.text === 'string' ? alt.message.text.trim() : '';
  if (!text) return reply(502, { error: 'empty' });
  return reply(200, { text });
}

module.exports = { handler, validate, buildUserText, SYSTEM_PROMPT };
