import { describe, expect, it } from 'vitest';
import type { AdviceDay, MinutePoint } from './advice-days';
import { AI_ADVICE_FORBIDDEN } from './ai-advice';
import {
  CAUSES_FOR,
  CAUSE_DETAIL,
  MIN_PAIR_SCORE,
  MIN_PAIR_SHARE,
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
    expect(insight.consequence).toBe('Пульс сейчас заметно выше обычного, хотя движения почти нет.');
    // Причина говорит, как это связано, а не просто ещё один факт (владелец 26.09: «чем связаны пульс и сон?»).
    expect(insight.rootCause).toMatch(/, (и|а) /);
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
    // Владелец 26.09: «низкая вариабельность сегодня — прямое следствие вчерашней физической работы».
    expect([insight.state, insight.cause]).toEqual(['hrv-low', 'repair']);
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
    const allowed = (s: BodyState) => Object.entries(CAUSES_FOR[s]).filter(([, w]) => w).map(([c]) => c);
    for (const s of ['still', 'idle', 'tense-still', 'fade'] as BodyState[]) expect(allowed(s)).not.toContain('long-still');
    expect(allowed('moving')).not.toContain('active-earlier');
    // Одна система не объясняет саму себя.
    expect(allowed('hrv-low')).not.toContain('hrv-down');
    expect(allowed('rest-up')).not.toContain('night-pulse');
    expect(allowed('sugar-swing')).not.toContain('sugar-swings');
    expect(allowed('steps-behind')).not.toContain('long-still');
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
    expect(keys).toEqual(expect.arrayContaining(['low-night-pulse', 'regular-bed', 'calm-days']));
  });

  it('все связки уже сказаны — берём самую давнюю, а не две по кругу', () => {
    const base = input({ pulse: 75, days: week({ sleepMin: 330, asleep: '01:00' }) });
    // Только осмысленные связки: слабее порога Лис не говорит даже ради разнообразия.
    const ranked = rankInsights(base);
    const floor = Math.max(MIN_PAIR_SCORE, ranked[0].weight * MIN_PAIR_SHARE);
    const all = ranked.filter((p) => p.weight >= floor).map((p) => `${p.state.key}-${p.cause.key}`);
    expect(all.length).toBeGreaterThan(1);
    // Свежие первыми: самая давняя — последняя в списке.
    const insight = findInsight({ ...base, said: { today: all, week: all } })!;
    expect(insight.key).toBe(all[all.length - 1]);
  });

  it('про сон — одна сторона: «долг сна» и «ночь была полноценной» не звучат по очереди', () => {
    // Прошлая ночь хорошая, но позапрошлая с малым глубоким сном — сильнее долг, «хорошая ночь» уходит.
    const days = week({ sleepMin: 470, deepMin: 92 }, { 1: { deepMin: 20 } });
    const causes = rootCauses(input({ pulse: 64, days })).map((c) => c.key);
    expect(causes).toContain('deep-debt');
    expect(causes).not.toContain('good-night');
  });

  it('день владельца 26.09, вечер: Организм −11 % — Лис начинает с него, говорит, что его тянет, и не рассказывает про сон', () => {
    // Его цифры: шаги 2387 (обычно 6642), ккал 145 (399), пульс покоя 57 (60), во сне 63 (66), долг сна 285 мин,
    // стресс за день 45 при обычных 33. На вкладке «Организм» — −11 % к норме; вариабельность просела.
    const usual = { steps: 6642, calories: 399, restingPulse: 60, nightPulse: 66, sleepMin: 349, deepMin: 108, hrv: 82, quietPulse: 76, stress: 33 };
    const days = [7, 6, 5, 4, 3, 2, 1, 0].map((ago) =>
      row(ago, ago === 0
        ? { ...usual, steps: 2387, calories: 145, restingPulse: 57, nightPulse: 63, sleepMin: 360, deepMin: 105, meals: ['13:00'], stress: 45 }
        : usual));
    const base: PhysioInput = {
      ...input({ pulse: 72, stress: 40, days }), sleepDebtMin: 285, mode: 'evening', now: 21 * 60,
      scores: { state: { value: 58, norm: 65 }, sleep: { value: 60, norm: 66 } },
      organismParts: { hrv: { today: 44, usual: 60 }, pulse: { today: 55, usual: 56 }, oxygen: { today: 90, usual: 93 }, bp: { today: 100, usual: 100 } },
    };
    const said: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      const insight = findInsight({ ...base, said: { today: [...said].reverse(), week: [...said] } })!;
      said.push(insight.key);
      lines.push(`${insight.consequence} ${insight.rootCause}`);
    }
    // Первое — главное на экране: Организм ниже нормы из-за вариабельности, и причина — стресс сегодня.
    expect(said[0]).toBe('org-low-hrv-stress-today');
    expect(lines[0]).toBe('Организм ниже нормы: просела вариабельность пульса. Стресс сегодня держится выше обычного, и телу сложнее расслабиться.');
    // Вечером про оценку сна не говорим, про «всё в норме» — тоже.
    expect(said.some((k) => k.startsWith('sleep-'))).toBe(false);
    expect(lines.join(' ')).not.toMatch(/как обычно|в норме|обычном коридоре/);
    // Четыре нажатия — четыре разных мысли; дальше говорить больше не о чем, и Лис возвращается к сказанному.
    expect(new Set(lines.slice(0, 4)).size).toBe(4);
    // Движение — главное, что ещё есть в этом дне, но два раза подряд о нём Лис не говорит.
    const move = said.map((k) => /^(still|steps-|burn-|moving)/.test(k));
    expect(move.some((m, i) => m && move[i - 1])).toBe(false);
  });

  it('утро: оценка сна ниже нормы — что её тянет и почему (легли поздно, поздний ужин)', () => {
    const days = week({ sleepMin: 380, asleep: '00:50' }, { 1: { meals: ['09:00', '13:30', '23:00'] } });
    const insight = findInsight({ ...input({ pulse: 64, days, mode: 'morning' }), scores: { sleep: { value: 62, norm: 80 } } })!;
    expect(insight.state).toBe('sleep-low-short');
    expect(insight.consequence).toBe('Сон заметно ниже нормы: вы спали намного меньше обычного.');
    expect(['late-bed', 'late-meal']).toContain(insight.cause);
  });

  it('отклонение оценки без причины — честно «явной причины не видно», а не молчание и не случайный факт', () => {
    const insight = findInsight({
      ...input({ pulse: 64, days: week() }),
      scores: { state: { value: 55, norm: 62 } },
      organismParts: { oxygen: { today: 80, usual: 95 } },
    })!;
    expect(insight.key).toBe('org-low-oxygen-no-cause');
    expect(insight.rootCause).toBe(`${CAUSE_TEXT['no-cause'][0]}.`);
    // Есть настоящая причина — «не видно» не звучит.
    const late = findInsight({
      ...input({ pulse: 64, days: week({ asleep: '01:10', sleepMin: 380 }) }),
      scores: { state: { value: 55, norm: 62 } },
      organismParts: { hrv: { today: 40, usual: 60 } },
    })!;
    expect(late.state).toBe('org-low-hrv');
    expect(rankInsights({ ...input({ pulse: 64, days: week({ asleep: '01:10', sleepMin: 380 }) }), scores: { state: { value: 55, norm: 62 } }, organismParts: { hrv: { today: 40, usual: 60 } } })
      .some((p) => p.cause.key === 'no-cause')).toBe(false);
  });

  it('вечером ночь звучит, только если была сильной; утром — в полную силу', () => {
    const days = week({ sleepMin: 395 });
    const at = (mode: PhysioInput['mode']) =>
      rankInsights({ ...input({ pulse: 80, days, mode }), scores: { state: { value: 55, norm: 62 } }, organismParts: { hrv: { today: 40, usual: 60 } } })
        .find((p) => p.cause.key === 'short-night')!.score;
    expect(at('evening')).toBeLessThan(at('morning') * 0.5);
  });

  it('план Vuelo как причина — изредка: легли позже окна сна, но не два раза за цикл', () => {
    const days = week({ asleep: '00:40' });
    const plan = { bedTo: 23 * 60 + 15, dinner: 19 * 60 };
    const causes = rootCauses({ ...input({ pulse: 64, days }), plan }).map((c) => c.key);
    expect(causes).toContain('past-bed-window');
    // Сон ниже своей нормы, а легли позже окна «Режима сна» — вот и причина.
    const scores = { sleep: { value: 70, norm: 80 } };
    const first = rankInsights({ ...input({ pulse: 64, days }), plan, scores }).find((p) => p.cause.key === 'past-bed-window')!;
    expect(first.state.key).toBe('sleep-low');
    const key = `${first.state.key}-past-bed-window`;
    const again = rankInsights({ ...input({ pulse: 64, days }), plan, scores, said: { today: [key], week: [key] } });
    expect(again.some((p) => p.cause.key === 'past-bed-window')).toBe(false);
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
      expect(text.length, text).toBeLessThanOrEqual(80);
      expect(text, text).not.toMatch(/\d|сделайте|попробуйте|встаньте|отдохните|разомните|(^|[^а-яё])(дела|делами|работа|работой|график|задач|загруженн)/i);
      expect(text, text).not.toMatch(/в покое|в спокойствии|наблюда|причина|мотор|шпар|^(Возможно|Вероятно|Скорее всего)/i);
      const words = text.toLowerCase().split(/[^a-zа-яё]+/);
      expect(AI_ADVICE_FORBIDDEN.some((stem) => words.some((w) => w.startsWith(stem))), text).toBe(false);
    }
    const pairs = (Object.keys(CAUSES_FOR) as BodyState[]).flatMap((s) =>
      (Object.entries(CAUSES_FOR[s]) as [RootCause, number][]).filter(([, w]) => w).map(([c]) => [s, c] as const));
    const texts = new Set(pairs.flatMap(([s, c]) => (['morning', 'day', 'evening'] as const).flatMap((m) =>
      STATE_TEXT[s][m].flatMap((a) => CAUSE_TEXT[c].map((b) => `${a} ${b}`)))));
    expect(texts.size).toBeGreaterThan(600);
    // Фраза движка целиком — запасной ответ посредника: до 140 символов.
    const causeTexts = (c: RootCause) => [...CAUSE_TEXT[c], ...(c === 'heavy-yesterday' ? Object.values(CAUSE_DETAIL.workout) : [])];
    for (const [s, c] of pairs) for (const m of ['morning', 'day', 'evening'] as const)
      for (const a of STATE_TEXT[s][m]) for (const b of causeTexts(c)) expect(`${a}. ${b}.`.length, `${a}. ${b}.`).toBeLessThanOrEqual(140);
  });
});
