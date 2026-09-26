import { describe, expect, it } from 'vitest';
import type { AdviceDay, MinutePoint } from './advice-days';
import { AI_ADVICE_FORBIDDEN } from './ai-advice';
import {
  CAUSES_FOR,
  CAUSE_DETAIL,
  CAUSE_TEXT,
  STATE_TEXT,
  findInsight,
  rankInsights,
  rootCauses,
  type BodyState,
  type PhysioInput,
  type RootCause,
} from './physiology';

/** Обычный день: сон 7.5 ч, глубокий 90 мин, пульс во сне 58, покоя 60, вариабельность 50, стресс 35, кислород ночью 97. */
function row(ago: number, over: Partial<AdviceDay> = {}): AdviceDay {
  return {
    ago, asleep: '23:30', awake: '07:00', sleepMin: 450, deepMin: 90, nightPulse: 58, hrv: 50, restingPulse: 60, quietPulse: 64,
    spo2: 97, nightSpo2: 97, systolic: 118, diastolic: 76, glucoseRange: 1.2, stress: 35, steps: 8000, stepNorm: 9000,
    calories: 300, load: 40, workout: null, meals: ['08:30', '13:30', '19:00'],
    ...over,
  };
}

const week = (today: Partial<AdviceDay> = {}, over: Record<number, Partial<AdviceDay>> = {}) =>
  [7, 6, 5, 4, 3, 2, 1, 0].map((ago) => row(ago, ago === 0 ? { meals: ['08:30', '13:30'], ...today } : over[ago] ?? {}));

/** «Сейчас» — 15:00; ряды на последние четыре часа: пульс и стресс раз в полчаса, шаги по минутам. */
function input(opts: {
  pulse: number;
  stress?: number;
  stepsPerMin?: number;
  stepsBefore?: number;
  days?: AdviceDay[];
  mode?: PhysioInput['mode'];
  night?: MinutePoint[];
  systolic?: number;
  glucose?: number[];
}): PhysioInput {
  const now = 15 * 60;
  const halfHours = Array.from({ length: 9 }, (_, i) => now - 240 + i * 30);
  const minutes = Array.from({ length: 240 }, (_, i) => now - 239 + i);
  return {
    mode: opts.mode ?? 'day',
    now,
    days: opts.days ?? week(),
    heart: [...(opts.night ?? []), ...halfHours.map((m) => ({ m, v: opts.pulse }))],
    stress: halfHours.map((m) => ({ m, v: opts.stress ?? 35 })),
    steps: minutes.map((m) => ({ m, v: m > now - 60 ? opts.stepsPerMin ?? 0 : opts.stepsBefore ?? 20 })),
    systolic: halfHours.map((m) => ({ m, v: opts.systolic ?? 118 })),
    glucose: (opts.glucose ?? [5.8, 6.1, 6.0]).map((v, i) => ({ m: 480 + i * 60, v })),
    said: { today: [], week: [] },
  };
}

const causesOf = (i: PhysioInput) => rootCauses(i).map((c) => c.key);

describe('СИНТЕТИЧЕСКИЕ: движок физиологии «Мнения Лиса»', () => {
  it('холостой ход: пульс на 15 % выше покоя без шагов — причина из ночи, а не из движения', () => {
    const days = week({ sleepMin: 330, deepMin: 50 }, { 1: { deepMin: 60 } });
    const insight = findInsight(input({ pulse: 80, days }))!;
    expect(insight.state).toBe('idle');
    expect(['short-night', 'deep-debt']).toContain(insight.cause);
    expect(insight.consequence).toBe('Пульс сейчас заметно выше обычного, хотя вы почти не двигаетесь.');
  });

  it('пульс сейчас сравнивается с обычным пульсом днём, а не с пульсом во сне (владелец 26.09: «постоянно про пульс»)', () => {
    // Покоя во сне 53, днём в покое обычно 72; сейчас 72 — это норма, а не «на треть выше обычного».
    const days = week({}, {}).map((d) => ({ ...d, restingPulse: 53, quietPulse: 72 }));
    const states = rankInsights(input({ pulse: 72, days })).map((p) => p.state.key);
    expect(states).not.toContain('idle');
    expect(states).toContain('steady');
    // 123 при движении — нагрузка, а не «ровно».
    const busy = rankInsights(input({ pulse: 123, stepsPerMin: 12, days })).map((p) => p.state.key);
    expect(busy).toContain('exertion');
    expect(busy).not.toContain('steady');
  });

  it('еда и пульс: скачок пульса через полчаса–час после еды — это переваривание, а не усталость', () => {
    const insight = findInsight(input({ pulse: 76, days: week({ meals: ['08:30', '14:15'] }) }))!;
    expect([insight.state, insight.cause]).toEqual(['idle', 'recent-meal']);
    // Сонливость после еды: пульс низкий, стресса нет — тоже еда.
    const sleepy = findInsight(input({ pulse: 58, stress: 15, stepsBefore: 5, days: week({ meals: ['08:30', '14:15'], steps: 3000 }) }))!;
    expect([sleepy.state, sleepy.cause]).toEqual(['saving', 'recent-meal']);
  });

  it('кислород ночью: просадка объясняет разбитость днём даже при долгом сне', () => {
    const days = week({ nightSpo2: 94, sleepMin: 480 });
    const causes = rootCauses(input({ pulse: 60, days }));
    const oxygen = causes.find((c) => c.key === 'night-oxygen')!;
    expect(oxygen.text).toBe(CAUSE_DETAIL.oxygenLongSleep);
    const insight = findInsight(input({ pulse: 60, stress: 20, stepsBefore: 0, days }))!;
    expect(insight.cause).toBe('night-oxygen');
  });

  it('поздно опустившийся ночной пульс после позднего ужина — восстановление началось с опозданием', () => {
    // Уснул в 00:10, ужин вчера в 22:30; первая половина ночи пульс 66, вторая — 56.
    const night = [20, 60, 100, 140, 180, 260, 300, 340, 380].map((m) => ({ m, v: m < 215 ? 66 : 56 }));
    const days = week({ asleep: '00:10' }, { 1: { meals: ['09:00', '22:30'] } });
    const late = rootCauses(input({ pulse: 60, days, night })).find((c) => c.key === 'late-recovery')!;
    expect(late.text).toBe(CAUSE_DETAIL.lateRecoveryAfterMeal);
    // Ровная ночь — такой причины нет.
    const flat = night.map((p) => ({ ...p, v: 57 }));
    expect(causesOf(input({ pulse: 60, days, night: flat }))).not.toContain('late-recovery');
  });

  it('нагрузка вчера и вариабельность сегодня: тело восстанавливает мышцы', () => {
    const days = week({ hrv: 40, steps: 2000 }, { 1: { workout: 'strength', load: 120 } });
    const insight = findInsight(input({ pulse: 60, stress: 20, stepsBefore: 5, days }))!;
    expect([insight.state, insight.cause]).toEqual(['saving', 'repair']);
    expect(insight.rootCause).toBe(`${CAUSE_DETAIL.repairAfterWorkout}.`);
    // Нагрузку видно и по шагам, без тренировки.
    expect(causesOf(input({ pulse: 60, days: week({ hrv: 40 }, { 1: { steps: 16000 } }) }))).toContain('repair');
  });

  it('стресс без шагов, давление выше своего, скачки сахара и перекусы', () => {
    expect(findInsight(input({ pulse: 62, stress: 75, days: week({ sleepMin: 330 }) }))?.state).toBe('tense-still');
    expect(findInsight(input({ pulse: 62, stress: 40, stepsPerMin: 5, systolic: 132, days: week({ sleepMin: 330 }) }))?.state).toBe('pressure-up');
    expect(causesOf(input({ pulse: 60, glucose: [5.2, 7.9, 5.6, 7.4] }))).toContain('sugar-swings');
    expect(causesOf(input({ pulse: 60, days: week({ meals: ['08:30', '10:30', '12:00', '13:30', '14:00'] }) }))).toContain('snacking');
  });

  it('тавтологий нет: статику не объясняем статикой, движение — движением', () => {
    for (const s of ['still', 'idle', 'tense-still', 'fade'] as BodyState[]) expect(CAUSES_FOR[s]).not.toContain('long-still');
    expect(CAUSES_FOR.moving).not.toContain('active-earlier');
  });

  it('ротация: повторные запросы подсвечивают другие связи, пока они есть', () => {
    const days = week({ sleepMin: 330, deepMin: 50, nightSpo2: 94, hrv: 40 }, { 1: { deepMin: 60, workout: 'cardio' } });
    const said = { today: [] as string[], week: [] as string[] };
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) {
      const insight = findInsight({ ...input({ pulse: 75, days }), said })!;
      keys.push(insight.key);
      said.today.push(insight.key);
      said.week.push(insight.key);
    }
    expect(new Set(keys).size).toBe(4);
    expect(rankInsights(input({ pulse: 75, days })).length).toBeGreaterThan(4);
  });

  it('«ровно» не спорит с отклонением: если пульс выше обычного, «пульс в норме» не прозвучит (скриншот 26.09)', () => {
    const ranked = rankInsights(input({ pulse: 76, days: week({ asleep: '01:00' }) }));
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((p) => p.state.key !== 'steady')).toBe(true);
    // В ровный день — разные спокойные причины, а не одно «ночь прошла как обычно».
    const calm = week({ nightPulse: 53, asleep: '23:35' }, { 1: { stress: 25 }, 2: { stress: 25 } });
    const keys = rankInsights(input({ pulse: 61, stress: 35, stepsPerMin: 20, days: calm })).map((p) => p.cause.key);
    expect(keys).toEqual(expect.arrayContaining(['low-night-pulse', 'regular-bed', 'calm-days', 'usual-night']));
  });

  it('все связки уже сказаны — берём самую давнюю, а не две по кругу', () => {
    const base = input({ pulse: 75, days: week({ sleepMin: 330, asleep: '01:00' }) });
    const all = rankInsights(base).map((p) => `${p.state.key}-${p.cause.key}`);
    expect(all.length).toBeGreaterThan(1);
    // Свежие первыми: самая давняя — последняя в списке.
    const insight = findInsight({ ...base, said: { today: all, week: all } })!;
    expect(insight.key).toBe(all[all.length - 1]);
  });

  it('нет замеров за последний час и нет сна — сказать нечего', () => {
    const empty = { ...input({ pulse: 60 }), heart: [], stress: [], steps: [], days: [row(0, { sleepMin: null, asleep: null, awake: null })] };
    expect(findInsight(empty)).toBeNull();
  });

  it('фразы: разговорный язык без цифр, команд, выдумок, канцелярита и диагнозов; сотни связок', () => {
    const phrases = [
      ...Object.values(STATE_TEXT).flatMap((byMode) => Object.values(byMode).flat()),
      ...Object.values(CAUSE_TEXT).flat(),
      ...Object.values(CAUSE_DETAIL.workout),
      CAUSE_DETAIL.repairAfterWorkout, CAUSE_DETAIL.lateRecoveryAfterMeal, CAUSE_DETAIL.lateRecoveryAfterLoad,
      CAUSE_DETAIL.oxygenLongSleep, CAUSE_DETAIL.snackingYesterday,
    ];
    for (const text of phrases) {
      expect(text.length, text).toBeLessThanOrEqual(75);
      expect(text, text).not.toMatch(/\d|сделайте|попробуйте|встаньте|отдохните|разомните|(^|[^а-яё])(дела|делами|работа|работой|график|задач|загруженн)/i);
      expect(text, text).not.toMatch(/в покое|в спокойствии|наблюда|причина|мотор|шпар|^(Возможно|Вероятно|Скорее всего)/i);
      const words = text.toLowerCase().split(/[^a-zа-яё]+/);
      expect(AI_ADVICE_FORBIDDEN.some((stem) => words.some((w) => w.startsWith(stem))), text).toBe(false);
    }
    const pairs = (Object.keys(CAUSES_FOR) as BodyState[]).flatMap((s) => CAUSES_FOR[s].map((c: RootCause) => [s, c] as const));
    const texts = new Set(pairs.flatMap(([s, c]) => (['morning', 'day', 'evening'] as const).flatMap((m) =>
      STATE_TEXT[s][m].flatMap((a) => CAUSE_TEXT[c].map((b) => `${a} ${b}`)))));
    expect(texts.size).toBeGreaterThan(600);
  });
});
