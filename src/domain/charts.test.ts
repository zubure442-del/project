import { describe, expect, it } from 'vitest';
import type { Sample } from '../codec';
import { LABEL_CHAR_W, LABEL_GAP, LABEL_LINE_H, chartAxis, deepShareLabel, placeLabels, formatMinute, hypnogramSegments, niceTicks, sleepStage, stepsByHour, stressZone } from './charts';

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

describe('зоны стресса', () => {
  it('четыре зоны как в официальном приложении: 0–30, 31–60, 61–80, 81–100', () => {
    expect(stressZone(1)).toBe('Низкий');
    expect(stressZone(30)).toBe('Низкий');
    expect(stressZone(31)).toBe('Умеренный');
    expect(stressZone(60)).toBe('Умеренный');
    expect(stressZone(61)).toBe('Повышенный');
    expect(stressZone(80)).toBe('Повышенный');
    expect(stressZone(81)).toBe('Высокий');
    expect(stressZone(100)).toBe('Высокий');
  });
  it('ноль и выход за шкалу — не замер', () => {
    expect(stressZone(0)).toBeNull();
    expect(stressZone(101)).toBeNull();
  });
});

describe('ярлык глубокого сна', () => {
  it('пороги 10, 15 и 20 процентов', () => {
    expect(deepShareLabel(0)).toBe('мало');
    expect(deepShareLabel(9)).toBe('мало');
    expect(deepShareLabel(10)).toBe('нормально');
    expect(deepShareLabel(14)).toBe('нормально');
    expect(deepShareLabel(15)).toBe('хорошо');
    expect(deepShareLabel(19)).toBe('хорошо');
    expect(deepShareLabel(20)).toBe('отлично');
    expect(deepShareLabel(35)).toBe('отлично');
  });
});

describe('ось статичных графиков «Тела»', () => {
  it('3–4 круглые отметки, крайние охватывают данные', () => {
    expect(chartAxis(10, 70, { min: 0, max: 100 }).ticks).toEqual([0, 50, 100]); // стресс
    expect(chartAxis(96, 99, { min: 90, max: 100 }).ticks).toEqual([90, 95, 100]); // кислород
    expect(chartAxis(45, 85).ticks).toEqual([40, 60, 80, 100]); // вариабельность
    expect(chartAxis(5.0, 6.4).ticks).toEqual([5, 5.5, 6, 6.5]); // глюкоза
    expect(chartAxis(70, 125).ticks).toEqual([50, 75, 100, 125]); // давление
  });
  it('кислород ниже 90 расширяет ось, а не обрезается', () => {
    const axis = chartAxis(86, 98, { min: 90, max: 100 });
    expect(axis.lo).toBeLessThanOrEqual(86);
    expect(axis.hi).toBeGreaterThanOrEqual(100);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
    expect(axis.ticks.length).toBeLessThanOrEqual(4);
  });
  it('одно значение не роняет ось', () => {
    const axis = chartAxis(80, 80);
    expect(axis.lo).toBeLessThan(80);
    expect(axis.hi).toBeGreaterThan(80);
  });
});

describe('числа над точками недели не накладываются', () => {
  const box = (x: number, base: number, text: string) => ({
    l: x - (text.length * LABEL_CHAR_W + 4) / 2,
    r: x + (text.length * LABEL_CHAR_W + 4) / 2,
    t: base - LABEL_LINE_H + 2,
    b: base + 2,
  });
  const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);

  it('далеко стоящие точки — подпись прямо над каждой', () => {
    const labels = [
      { x: 20, y: 60, text: '72', selected: false },
      { x: 80, y: 50, text: '65', selected: true },
    ];
    expect(placeLabels(labels, { top: 0, bottom: 100 })).toEqual([60 - LABEL_GAP, 50 - LABEL_GAP]);
  });

  it('тесно стоящие точки: выбранная остаётся на месте, соседние сдвигаются без наложений', () => {
    const labels = [
      { x: 30, y: 60, text: '100', selected: false },
      { x: 40, y: 60, text: '99', selected: true },
      { x: 50, y: 61, text: '101', selected: false },
    ];
    const bases = placeLabels(labels, { top: 0, bottom: 120 });
    expect(bases[1]).toBe(60 - LABEL_GAP);
    const boxes = labels.map((l, i) => box(l.x, bases[i], l.text));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
  });
});
