import { describe, expect, it } from 'vitest';
import { WORKOUT, dayLoad, loadRatio, pulseAtShare, workoutPlan, zoneOf, type DayLoad, type WorkoutInput } from './training';

const AGE = 30; // максимальный пульс 187
const REST = 55;
const TODAY = '2026-09-26';
const dateBefore = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

const load = (trimp: number, session: DayLoad['session'] = null, high = 0): DayLoad => ({
  trimp,
  low: trimp,
  high,
  anaerobic: 0,
  session,
});
/** История: n дней назад → нагрузка. */
const history = (days: Record<number, DayLoad>) =>
  Object.entries(days).map(([ago, l]) => ({ date: dateBefore(Number(ago)), load: l }));
/** Ровная история на 28 дней: тренировка раз в три дня. */
const regular = (session: DayLoad['session'] = 'cardio', high = 5) =>
  Object.fromEntries(Array.from({ length: 28 }, (_, i) => [i + 1, (i + 1) % 3 === 0 ? load(90, session, high) : load(10)]));

const input = (over: Partial<WorkoutInput>): WorkoutInput => ({
  readiness: 'high',
  goal: 'keep',
  history: history(regular()),
  today: TODAY,
  windowMin: 120,
  ...over,
});

describe('СИНТЕТИЧЕСКИЕ: личные пульсовые зоны (Карвонен)', () => {
  it('зоны от пульса покоя и максимального', () => {
    // Резерв 187 − 55 = 132: зона 2 — 60–70 % резерва.
    expect([pulseAtShare(0.6, AGE, REST), pulseAtShare(0.7, AGE, REST)]).toEqual([134, 147]);
    expect(zoneOf(60, AGE, REST)).toBe(0);
    expect(zoneOf(150, AGE, REST)).toBe(3);
    // Без пульса покоя — доля максимального.
    expect([pulseAtShare(0.6, AGE, null), pulseAtShare(0.7, AGE, null)]).toEqual([112, 131]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: нагрузка дня', () => {
  it('минуты по зонам и TRIMP; пробежка с шагами — кардио', () => {
    const heart = [{ m: 600, v: 150 }, { m: 615, v: 160 }, { m: 630, v: 158 }, { m: 645, v: 80 }];
    const steps = Array.from({ length: 45 }, (_, i) => ({ m: 600 + i, v: 150 }));
    const day = dayLoad(heart, steps, AGE, REST)!;
    expect(day.high).toBe(45);
    expect(day.session).toBe('cardio');
    expect(day.trimp).toBeGreaterThan(100);
  });

  it('пульс высокий, шагов почти нет — силовая', () => {
    const heart = [{ m: 600, v: 150 }, { m: 610, v: 155 }, { m: 620, v: 152 }, { m: 630, v: 150 }, { m: 640, v: 75 }];
    expect(dayLoad(heart, [], AGE, REST)?.session).toBe('strength');
  });

  it('обычный день без тренировки — нагрузки почти нет; возраста нет — нет и нагрузки', () => {
    const calm = dayLoad([{ m: 600, v: 72 }, { m: 630, v: 80 }], [], AGE, REST)!;
    expect(calm.trimp).toBe(0);
    expect(calm.session).toBeNull();
    expect(dayLoad([{ m: 600, v: 150 }], [], null, REST)).toBeNull();
  });
});

describe('СИНТЕТИЧЕСКИЕ: тренировка дня — индивидуально', () => {
  it('отношение недели к привычной нагрузке; мало истории — нет', () => {
    const ratio = loadRatio(history(regular()), TODAY)!;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.3);
    expect(loadRatio(history({ 1: load(50), 2: load(50) }), TODAY)).toBeNull();
  });

  it('по замерам лучше поберечься — лёгкая прогулка, самая лёгкая нагрузка', () => {
    const plan = workoutPlan(input({ readiness: 'recovery' }));
    expect(plan.kind).toBe('recovery');
    expect(plan.title).toBe('Лёгкая прогулка');
    expect(plan.effort).toBe(1);
  });

  it('новичок без тренировок за две недели — кардио только базовое, даже при высокой готовности', () => {
    const idle = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [i + 1, load(0)]));
    // Последняя тренировка — силовая неделю назад: сегодня кардио.
    expect(workoutPlan(input({ history: history({ ...idle, 6: load(0, 'strength') }) })).kind).toBe('base');
  });

  // Последняя тренировка — силовая: при поддержании формы сегодня кардио.
  const afterStrength = (base = regular()) => ({ ...base, 3: load(90, 'strength') });

  it('тренируется регулярно и готов — ключевая: пороговая, если интенсивного мало, иначе темповая', () => {
    expect(workoutPlan(input({ history: history(afterStrength()) })).kind).toBe('threshold');
    expect(workoutPlan(input({ history: history(afterStrength(regular('cardio', 60))) })).kind).toBe('tempo');
  });

  it('последняя неделя намного легче привычной — интервалы', () => {
    const light = { ...regular(), 1: load(0), 2: load(0), 3: load(0), 4: load(0), 5: load(0), 6: load(0), 7: load(0, 'strength') };
    // Сессий за две недели ещё хватает.
    const withSessions = { ...light, 8: load(90, 'strength'), 12: load(90, 'cardio'), 13: load(90, 'cardio'), 14: load(90, 'cardio') };
    expect(workoutPlan(input({ history: history(withSessions) })).kind).toBe('intervals');
  });

  const KEY = ['threshold', 'tempo', 'intervals', 'strength', 'hypertrophy'];
  const CARDIO = ['recovery', 'base', 'tempo', 'threshold', 'intervals'];

  it('неделя в полтора раза тяжелее привычной — только лёгкая тренировка', () => {
    const heavy = { ...regular(), 1: load(300, 'cardio'), 2: load(250, 'cardio'), 3: load(250, 'cardio') };
    expect(['recovery', 'mobility']).toContain(workoutPlan(input({ history: history(heavy) })).kind);
  });

  it('вчера было тяжело — сегодня не ключевая тренировка', () => {
    const hardYesterday = { ...afterStrength(), 1: load(200, 'cardio') };
    expect(KEY).not.toContain(workoutPlan(input({ history: history(hardYesterday) })).kind);
  });

  it('цель: набор массы — на массу, похудение — кардио, после вчерашней силовой — кардио', () => {
    expect(workoutPlan(input({ goal: 'gain' })).kind).toBe('hypertrophy');
    expect(CARDIO).toContain(workoutPlan(input({ goal: 'gain', history: history({ ...regular(), 1: load(90, 'strength') }) })).kind);
    expect(CARDIO).toContain(workoutPlan(input({ goal: 'lose', history: history(regular('strength')) })).kind);
  });

  it('похудение без силовых целую неделю — круговая, чтобы сохранить мышцы', () => {
    expect(workoutPlan(input({ goal: 'lose' })).kind).toBe('circuit');
  });

  it('поддержание формы: чередуем с тем, что было в последний раз; тяжёлая силовая — если силовые уже регулярны', () => {
    const cardioLast = history({ ...regular(), 1: load(40, 'cardio') });
    expect(workoutPlan(input({ goal: 'keep', history: cardioLast })).kind).toBe('hypertrophy');
    const strengthRegular = history({ ...regular('strength'), 1: load(40, 'cardio') });
    expect(workoutPlan(input({ goal: 'keep', history: strengthRegular })).kind).toBe('strength');
    expect(CARDIO).toContain(workoutPlan(input({ goal: 'keep', history: history({ ...regular(), 2: load(90, 'strength') }) })).kind);
  });

  it('тренировок в данных нет — не одно и то же каждый день: чередование по цели', () => {
    const idle = history(Object.fromEntries(Array.from({ length: 28 }, (_, i) => [i + 1, load(0)])));
    const week = (goal: WorkoutInput['goal']) =>
      Array.from({ length: 6 }, (_, i) => {
        const today = new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
        return workoutPlan(input({ goal, today, history: idle })).kind;
      });
    expect(new Set(week('keep'))).toEqual(new Set(['base', 'hypertrophy']));
    expect(week('lose').filter((k) => k === 'circuit')).toHaveLength(2);
    expect(week('lose').filter((k) => k === 'base')).toHaveLength(4);
  });

  it('у силовых — подходы и повторения словами, длительность одним числом и не больше окна пика', () => {
    const plan = workoutPlan(input({ goal: 'gain', windowMin: 45 }));
    expect(plan.hint).toBe('3–4 подхода по 8–12 повторений');
    expect(plan.minutes).toBe(45);
    expect(workoutPlan(input({ goal: 'gain', windowMin: 120 })).minutes).toBe(50);
  });

  it('на экране простые слова: без зон, пульса и терминов', () => {
    for (const w of Object.values(WORKOUT)) {
      const text = `${w.title} ${w.hint}`;
      expect(text).not.toMatch(/зон|пульс|аэроб|МПК|порог|×/i);
    }
  });
});
