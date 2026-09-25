import { describe, expect, it } from 'vitest';
import { dayInsights, glucoseRises, type InsightInput, type MinutePoint } from './insights';
import type { DayLoad } from './training';

/** Глюкоза раз в 30 минут с 7:00 до 21:00 на уровне 6.0 и подъёмы после еды в заданные минуты. */
const glucoseDay = (rises: number[], until = 21 * 60): MinutePoint[] =>
  Array.from({ length: (until - 420) / 30 + 1 }, (_, i) => {
    const m = 420 + i * 30;
    return { m, v: rises.some((r) => m >= r && m < r + 60) ? 7.6 : 6 };
  });
/** Шаги по минутам: по 40 шагов каждые 10 минут с `from` до `to`, кроме пропуска. */
const stepsDay = (from: number, to: number, gap?: [number, number]): MinutePoint[] =>
  Array.from({ length: Math.floor((to - from) / 10) + 1 }, (_, i) => ({ m: from + i * 10, v: 40 })).filter(
    (p) => !gap || p.m < gap[0] || p.m > gap[1],
  );
const load = (trimp: number, session: DayLoad['session'] = null): DayLoad => ({ trimp, low: trimp, high: 0, anaerobic: 0, session });
const night = { asleep: -10, totalMin: 450, deepMin: 80 };

/** Обычный день, как неделя до него: наблюдений нет. */
const usual = (): InsightInput => ({
  dataMinute: 15 * 60,
  glucose: { today: glucoseDay([480, 800]), yesterday: glucoseDay([480, 800, 1140]), history: Array.from({ length: 7 }, () => glucoseDay([480, 800, 1140])) },
  sleep: { asleep: -10, totalMin: 450, deepMin: 80, history: Array.from({ length: 6 }, () => night) },
  nightPulseDelta: 1,
  hrv: { today: 50, history: [48, 52, 50, 49, 51] },
  steps: { today: stepsDay(420, 900), history: Array.from({ length: 7 }, () => stepsDay(420, 1320)), wake: 420 },
  stress: { today: [600, 700, 800, 880].map((m) => ({ m, v: 30 })), history: Array.from({ length: 7 }, () => [600, 700, 800, 900].map((m) => ({ m, v: 30 }))) },
  load: { yesterday: load(40), history: Array.from({ length: 20 }, () => load(40)) },
});

describe('СИНТЕТИЧЕСКИЕ: наблюдения для «Мнения Лиса»', () => {
  it('обычный день — наблюдений нет', () => {
    expect(dayInsights(usual())).toEqual([]);
  });

  it('подъёмы глюкозы: начало подъёма — замер выше уровня на 15 % после замера ниже', () => {
    expect(glucoseRises(glucoseDay([480, 800]), 6)).toEqual([480, 810]);
  });

  it('частые подъёмы — «похоже на частые перекусы»; поздний вчера — «поздний ужин»', () => {
    const input = usual();
    input.glucose.today = glucoseDay([480, 600, 720, 840]);
    input.glucose.yesterday = glucoseDay([480, 800, 1290], 23 * 60);
    const out = dayInsights(input).join(' ');
    expect(out).toContain('поднималась 4 раз, обычно к этому времени 2');
    expect(out).toContain('частые перекусы');
    expect(out).toContain('Вчера в 21:30 был подъём глюкозы');
  });

  it('сон: засыпание позже обычного, сна меньше, глубокого меньше своей нормы', () => {
    const input = usual();
    input.sleep = { ...input.sleep, asleep: 70, totalMin: 380, deepMin: 50 };
    const out = dayInsights(input).join(' ');
    expect(out).toContain('Засыпание в 01:10 — на 1 ч 20 мин позже обычного (обычно около 23:50)');
    expect(out).toContain('Сна 6 ч 20 мин — меньше обычного');
    expect(out).toContain('Глубокого сна 50 мин — на 38 % меньше своей нормы');
  });

  it('восстановление: пульс во сне выше нормы, вариабельность ниже, вчера тяжёлая тренировка', () => {
    const input = usual();
    input.nightPulseDelta = 6;
    input.hrv.today = 40;
    input.load.yesterday = load(90, 'strength');
    const out = dayInsights(input).join(' ');
    expect(out).toContain('Пульс во сне на 6 уд/мин выше своей нормы');
    expect(out).toContain('на 20 % ниже своей нормы');
    expect(out).toContain('Вчера нагрузка была в 2,3 раза выше привычной, была силовая тренировка');
  });

  it('движение: к 15:00 шагов меньше обычного и три часа без движения', () => {
    const input = usual();
    input.steps.today = stepsDay(420, 900, [620, 840]);
    const out = dayInsights(input).join(' ');
    expect(out).toContain('день малоподвижнее обычного');
    expect(out).toContain('С 10:10 до 14:10 почти не было шагов — 4 ч без движения');
  });

  it('стресс днём выше обычного — с пиком', () => {
    const input = usual();
    input.stress.today = [600, 700, 800, 880].map((m, i) => ({ m, v: i === 2 ? 70 : 45 }));
    expect(dayInsights(input).join(' ')).toContain('Стресс днём выше обычного: в среднем 51 против обычных 30, пик около 13:00');
  });

  it('мало истории — своей нормы нет, наблюдений по сну и шагам тоже', () => {
    const input = usual();
    input.sleep = { asleep: 90, totalMin: 300, deepMin: 20, history: [night] };
    input.steps = { ...input.steps, today: [], history: [] };
    expect(dayInsights(input)).toEqual([]);
  });
});
