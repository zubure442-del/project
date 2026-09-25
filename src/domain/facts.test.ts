import { describe, expect, it } from 'vitest';
import { dayFacts, glucoseRises, type FactsInput, type MinutePoint } from './facts';
import type { DayLoad } from './training';

/** Глюкоза раз в 30 минут с 7:00 на уровне 6.0 и подъёмы после еды в заданные минуты. */
const glucoseDay = (rises: number[], until = 21 * 60): MinutePoint[] =>
  Array.from({ length: (until - 420) / 30 + 1 }, (_, i) => {
    const m = 420 + i * 30;
    return { m, v: rises.some((r) => m >= r && m < r + 60) ? 7.6 : 6 };
  });
/** Шаги: по 40 каждые 10 минут с `from` до `to`, кроме пропуска. */
const stepsDay = (from: number, to: number, gap?: [number, number]): MinutePoint[] =>
  Array.from({ length: Math.floor((to - from) / 10) + 1 }, (_, i) => ({ m: from + i * 10, v: 40 })).filter(
    (p) => !gap || p.m < gap[0] || p.m > gap[1],
  );
const load = (trimp: number, session: DayLoad['session'] = null): DayLoad => ({ trimp, low: trimp, high: 0, anaerobic: 0, session });
const night = { asleep: -20, awake: 430, totalMin: 440, deepMin: 75 };

const input = (): FactsInput => ({
  dataMinute: 15 * 60,
  sleep: { asleep: 70, awake: 450, totalMin: 380, deepMin: 50, history: Array.from({ length: 6 }, () => night) },
  nightPulse: { min: 55, avg: 62, norm: { min: 51, avg: 56 } },
  hrv: { today: 41, history: [48, 50, 49, 51, 47] },
  restingPulse: { today: 57, history: [54, 55, 53] },
  spo2: { today: 97, history: [97, 96, 97] },
  steps: { today: stepsDay(420, 900, [650, 850]), history: Array.from({ length: 7 }, () => stepsDay(420, 1320)), wake: 450 },
  stress: {
    today: [600, 700, 720, 800].map((m, i) => ({ m, v: i === 1 ? 68 : 40 })),
    history: Array.from({ length: 7 }, () => [600, 700, 800, 900].map((m) => ({ m, v: 30 }))),
  },
  glucose: { today: glucoseDay([480, 700, 810]), yesterday: glucoseDay([480, 780, 1290], 23 * 60), history: Array.from({ length: 7 }, () => glucoseDay([480, 800, 1140])) },
  yesterday: { steps: 11800, norm: 9000, load: load(44), history: Array.from({ length: 20 }, () => load(40)) },
});

describe('СИНТЕТИЧЕСКИЕ: факты дня для «Мнения Лиса» — сегодня против обычного, без выводов', () => {
  const facts = dayFacts(input());
  // Числа форматируются с неразрывным пробелом (как на экране): сравниваем без учёта вида пробела.
  const all = facts.join('\n').replace(/\u00a0/g, ' ');

  it('сон: засыпание, подъём, длительность и глубокий — с обычным и разницей', () => {
    expect(facts[0]).toBe(
      'Сон прошлой ночи: засыпание 01:10 (обычно 23:40, на 1 ч 30 мин позже); подъём 07:30 (обычно 07:10, на 20 мин позже); ' +
        'сна всего 6 ч 20 мин (обычно 7 ч 20 мин, на 1 ч меньше); глубокого 50 мин (обычно 1 ч 15 мин, на 25 мин меньше).',
    );
  });

  it('тело и вчерашний день: числа и своя норма', () => {
    expect(all).toContain('Пульс во сне: средний 62 (обычно 56), минимальный 55 (обычно 51).');
    expect(all).toContain('Вариабельность за день: 41 мс (обычно 49 мс).');
    expect(all).toContain('Пульс покоя: 57 (обычно 54).');
    expect(all).toContain('Вчера: 11 800 шагов при норме 9 000; нагрузка по пульсу 1,1 от обычной; тренировки не было.');
  });

  it('движение: шаги по часам как есть, доля от обычного к этому часу, самый долгий отрезок без шагов', () => {
    expect(all).toMatch(/Шаги сегодня по часам: 7 ч — 240, 8 ч — 240, 9 ч — 240, 10 ч — 200, 11 ч — 0, 12 ч — 0, 13 ч — 0, 14 ч — 160, 15 ч — 40\./);
    expect(all).toContain('К 15:00 шагов 57 % от обычного к этому часу.');
    expect(all).toContain('Самый долгий отрезок без шагов: 10:40–14:20 (3 ч 40 мин).');
  });

  it('стресс и подъёмы глюкозы — времена, без значений глюкозы', () => {
    expect(all).toContain('Стресс днём (шкала 0–100): в среднем 47 (обычно 30), самый высокий 68 около 11:00.');
    expect(all).toContain('Подъёмы глюкозы сегодня: 08:00, 12:00, 13:30 — 3 (обычно к этому часу 2,0).');
    expect(all).toContain('Подъёмы глюкозы вчера: 08:00, 13:00, 21:30.');
    expect(glucoseRises(glucoseDay([480, 800]), 6)).toEqual([480, 810]);
  });

  it('никаких готовых выводов и советов — только «сегодня» и «обычно»', () => {
    expect(all).not.toMatch(/похоже|перекус|ужин|сидени|стоит|лучше|признак|причин/i);
  });

  it('мало истории — без «обычно», только сегодняшние числа', () => {
    const fresh = input();
    fresh.sleep.history = [night];
    fresh.hrv.history = [];
    fresh.nightPulse = { min: 55, avg: 62, norm: null };
    const out = dayFacts(fresh).join('\n').replace(/\u00a0/g, ' ');
    expect(out).toContain('Сон прошлой ночи: засыпание 01:10; подъём 07:30; сна всего 6 ч 20 мин; глубокого 50 мин.');
    expect(out).toContain('Пульс во сне: средний 62, минимальный 55.');
    expect(out).toContain('Вариабельность за день: 41 мс.');
  });
});
