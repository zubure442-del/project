import { describe, expect, it } from 'vitest';
import type { AdviceDay } from './advice-days';
import { AI_ADVICE_FORBIDDEN } from './ai-advice';
import {
  CAUSES_FOR,
  CAUSE_TEXT,
  STATE_TEXT,
  findInsight,
  rootCauses,
  type BodyState,
  type PhysioInput,
  type RootCause,
} from './physiology';

/** Обычный день: сон 7.5 ч, глубокий 90 мин, пульс во сне 58, покоя 60, вариабельность 50, стресс 35. */
function row(ago: number, over: Partial<AdviceDay> = {}): AdviceDay {
  return {
    ago, asleep: '23:30', awake: '07:00', sleepMin: 450, deepMin: 90, nightPulse: 58, hrv: 50, restingPulse: 60,
    spo2: 97, stress: 35, steps: 8000, stepNorm: 9000, calories: 300, load: 40, workout: null, meals: ['08:30', '13:30', '19:00'],
    ...over,
  };
}

const week = (today: Partial<AdviceDay> = {}, over: Record<number, Partial<AdviceDay>> = {}) =>
  [7, 6, 5, 4, 3, 2, 1, 0].map((ago) => row(ago, ago === 0 ? { meals: ['08:30', '13:30'], ...today } : over[ago] ?? {}));

/** «Сейчас» — 15:00; ряды на последние четыре часа: пульс и стресс раз в полчаса, шаги по минутам. */
function input(opts: { pulse: number; stress?: number; stepsPerMin?: number; stepsBefore?: number; days?: AdviceDay[]; mode?: PhysioInput['mode'] }): PhysioInput {
  const now = 15 * 60;
  const halfHours = Array.from({ length: 9 }, (_, i) => now - 240 + i * 30);
  const minutes = Array.from({ length: 240 }, (_, i) => now - 239 + i);
  return {
    mode: opts.mode ?? 'day',
    now,
    days: opts.days ?? week(),
    heart: halfHours.map((m) => ({ m, v: opts.pulse })),
    stress: halfHours.map((m) => ({ m, v: opts.stress ?? 35 })),
    steps: minutes.map((m) => ({ m, v: m > now - 60 ? opts.stepsPerMin ?? 0 : opts.stepsBefore ?? 20 })),
    said: { today: [], week: [] },
  };
}

describe('СИНТЕТИЧЕСКИЕ: движок физиологии «Мнения Лиса»', () => {
  it('холостой ход: пульс на 15 % выше покоя без шагов — причина из ночи, а не из движения', () => {
    const days = week({ sleepMin: 330, deepMin: 50 }, { 1: { deepMin: 60 } });
    const insight = findInsight(input({ pulse: 75, days }))!;
    expect(insight.state).toBe('idle');
    expect(['short-night', 'deep-debt']).toContain(insight.cause);
    expect(insight.key).toBe(`idle-${insight.cause}`);
    expect(insight.consequence).toBe('Сейчас движения почти нет, а пульс заметно выше покоя.');
  });

  it('режим сбережения сил: низкий пульс и спокойный фон без шагов — после подвижной первой половины дня', () => {
    const insight = findInsight(input({ pulse: 60, stress: 20, stepsBefore: 30 }))!;
    expect(insight.state).toBe('saving');
    expect(insight.cause).toBe('active-earlier');
  });

  it('вчерашняя тренировка и поздний ужин — первопричины из вчерашнего дня', () => {
    const workout = findInsight(input({ pulse: 60, stress: 20, stepsBefore: 5, days: week({ steps: 2000 }, { 1: { workout: 'strength', load: 120 } }) }))!;
    expect([workout.state, workout.cause]).toEqual(['saving', 'heavy-yesterday']);
    expect(workout.rootCause).toBe('Вчера была силовая тренировка, мышцы ещё восстанавливаются.');
    // Уснул в 00:10, последний подъём глюкозы вчера в 22:30 — поздний ужин; в 21:00 — ещё нет.
    const late = rootCauses(input({ pulse: 60, days: week({ asleep: '00:10' }, { 1: { meals: ['09:00', '22:30'] } }) }));
    expect(late.map((c) => c.key)).toContain('late-meal');
    const early = rootCauses(input({ pulse: 60, days: week({ asleep: '00:10' }, { 1: { meals: ['09:00', '19:00'] } }) }));
    expect(early.map((c) => c.key)).not.toContain('late-meal');
  });

  it('тавтологий нет: статику не объясняем статикой, движение — движением', () => {
    expect(CAUSES_FOR.still).not.toContain('long-still');
    expect(CAUSES_FOR.moving).not.toContain('active-earlier');
    const still = findInsight(input({ pulse: 61, stress: 45, stepsPerMin: 0, stepsBefore: 0, days: week({ sleepMin: 330 }) }))!;
    expect(still.cause).not.toBe('long-still');
  });

  it('о чём уже говорили — отодвигается: та же картина даёт другую связку', () => {
    const days = week({ sleepMin: 330, deepMin: 50 }, { 1: { deepMin: 60 } });
    const first = findInsight(input({ pulse: 72, days }))!;
    const second = findInsight({ ...input({ pulse: 72, days }), said: { today: [first.key], week: [first.key] } })!;
    expect(second.key).not.toBe(first.key);
    expect(second.state).toBe('idle');
  });

  it('нет замеров за последний час и нет сна — сказать нечего', () => {
    const empty = { ...input({ pulse: 60 }), heart: [], stress: [], steps: [], days: [row(0, { sleepMin: null, asleep: null, awake: null })] };
    expect(findInsight(empty)).toBeNull();
  });

  it('фразы: без цифр, команд, выдуманных дел, запретных слов и вводных «возможно/вероятно»; сотни связок', () => {
    const phrases = [
      ...Object.values(STATE_TEXT).flatMap((byMode) => Object.values(byMode).flat()),
      ...Object.values(CAUSE_TEXT).flat(),
    ];
    for (const text of phrases) {
      expect(text.length, text).toBeLessThanOrEqual(70);
      expect(text, text).not.toMatch(/\d|сделайте|попробуйте|встаньте|отдохните|разомните|(^|[^а-яё])(дела|делами|работа|работой|график|задач|загруженн)/i);
      expect(text, text).not.toMatch(/^(Возможно|Вероятно|Скорее всего)/);
      const words = text.toLowerCase().split(/[^a-zа-яё]+/);
      expect(AI_ADVICE_FORBIDDEN.some((stem) => words.some((w) => w.startsWith(stem))), text).toBe(false);
    }
    const pairs = (Object.keys(CAUSES_FOR) as BodyState[]).flatMap((s) => CAUSES_FOR[s].map((c: RootCause) => [s, c]));
    // Пара × отрезок дня × сила состояния × сила причины — разные тексты.
    const texts = new Set(pairs.flatMap(([s, c]) => (['morning', 'day', 'evening'] as const).flatMap((m) =>
      STATE_TEXT[s as BodyState][m].flatMap((a) => CAUSE_TEXT[c as RootCause].map((b) => `${a} ${b}`)))));
    expect(texts.size).toBeGreaterThan(300);
  });
});
