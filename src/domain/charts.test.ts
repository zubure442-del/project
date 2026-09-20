import { describe, expect, it } from 'vitest';
import type { Sample } from '../codec';
import { formatMinute, hypnogramSegments, niceTicks, sleepStage, stepsByHour } from './charts';

const ring = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') / 1000;
const minutes = (from: string, values: number[]): Sample[] =>
  values.map((value, i) => ({ ts: ring(from) + i * 60, value }));

describe('фазы сна', () => {
  it('порог глубокого сна — 80, бодрствование — ноль', () => {
    expect(sleepStage(0)).toBe('awake');
    expect(sleepStage(1)).toBe('light');
    expect(sleepStage(79)).toBe('light');
    expect(sleepStage(80)).toBe('deep');
  });
});

describe('гипнограмма', () => {
  it('соседние минуты одной фазы сливаются в отрезок', () => {
    const s = hypnogramSegments(minutes('2026-09-19 23:00:00', [40, 40, 40, 85, 85, 0]));
    expect(s.map((x) => x.stage)).toEqual(['light', 'deep', 'awake']);
    expect(s[0].to - s[0].from).toBe(180);
    expect(s[1].to - s[1].from).toBe(120);
  });
  it('отрезки идут встык и покрывают всю ночь', () => {
    const s = hypnogramSegments(minutes('2026-09-19 23:00:00', [40, 85, 40]));
    expect(s[0].to).toBe(s[1].from);
    expect(s[1].to).toBe(s[2].from);
    expect(s[s.length - 1].to - s[0].from).toBe(180);
  });
  it('пропуск данных разрывает отрезок, а не затягивается', () => {
    const early = minutes('2026-09-19 23:00:00', [40, 40]);
    const late = minutes('2026-09-20 01:00:00', [40]);
    const s = hypnogramSegments([...early, ...late]);
    expect(s).toHaveLength(2);
    expect(s[0].to).toBeLessThan(s[1].from);
  });
  it('вход не меняется, порядок не важен', () => {
    const input = minutes('2026-09-19 23:00:00', [40, 85]);
    const shuffled = [input[1], input[0]];
    expect(hypnogramSegments(shuffled)).toEqual(hypnogramSegments(input));
    expect(shuffled[0]).toBe(input[1]);
  });
  it('пустой вход — пустой результат', () => {
    expect(hypnogramSegments([])).toEqual([]);
  });
});

describe('шаги по часам', () => {
  it('суммирует минуты внутри часа', () => {
    const h = stepsByHour([
      { ts: ring('2026-09-19 08:05:00'), value: 30 },
      { ts: ring('2026-09-19 08:40:00'), value: 20 },
      { ts: ring('2026-09-19 19:00:00'), value: 7 },
    ]);
    expect(h).toHaveLength(24);
    expect(h[8]).toBe(50);
    expect(h[19]).toBe(7);
    expect(h[0]).toBe(0);
    expect(h.reduce((a, b) => a + b, 0)).toBe(57);
  });
  it('пустой день — 24 нуля', () => {
    expect(stepsByHour([]).every((v) => v === 0)).toBe(true);
  });
});

describe('подписи оси', () => {
  it('круглые значения внутри диапазона', () => {
    expect(niceTicks(0, 100, 3)).toEqual([0, 50, 100]);
    expect(niceTicks(90, 100, 3)).toEqual([90, 95, 100]);
  });
  it('не выходит за границы', () => {
    for (const t of niceTicks(53, 147, 4)) {
      expect(t).toBeGreaterThanOrEqual(53);
      expect(t).toBeLessThanOrEqual(147);
    }
  });
  it('вырожденный диапазон не роняет', () => {
    expect(niceTicks(50, 50)).toEqual([50]);
    expect(niceTicks(10, 0)).toEqual([10]);
  });
});

describe('время', () => {
  it('минуты от полуночи в часы:минуты', () => {
    expect(formatMinute(0)).toBe('0:00');
    expect(formatMinute(425)).toBe('7:05');
    expect(formatMinute(1439)).toBe('23:59');
    expect(formatMinute(1440)).toBe('24:00');
  });
  it('отрицательные минуты — предыдущий вечер', () => {
    expect(formatMinute(-50)).toBe('23:10');
  });
});
