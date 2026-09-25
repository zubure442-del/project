import { describe, expect, it } from 'vitest';
import { avoidMeals, endurancePeak, sustained, type EnduranceInput } from './endurance';

/** Подъём в 7:00, сон как обычно, замеры в норме, еды нет. */
const base: EnduranceInput = {
  wakeMinute: 7 * 60,
  bedtimeMinute: 23 * 60,
  deepMin: 90,
  lightMin: 330,
  deepNorm: 90,
  lightNorm: 330,
  nightHrv: 50,
  hrvNorm: 50,
  nightPulse: 60,
  pulseNorm: 60,
  nightSpo2: [{ m: 60, v: 97 }, { m: 90, v: 98 }],
  dayPressure: [{ m: 600, systolic: 118, diastolic: 76 }],
  glucose: [{ m: 600, v: 5.2 }],
  stressByHour: new Array(24).fill(null),
  meals: [],
};
const hh = (h: number, m = 0) => h * 60 + m;

describe('СИНТЕТИЧЕСКИЕ: «Пик выносливости»', () => {
  it('шаг 1: подъём + 10 часов, окно ±1 час, полная нагрузка', () => {
    expect(endurancePeak(base)).toEqual({ from: hh(16), to: hh(18), intensity: 100, kind: 'training', flags: [] });
  });

  it('шаг 2: сон слабее нормы (K < 0.8) — окно на 1.5 часа раньше, нагрузка −20 %', () => {
    const r = endurancePeak({ ...base, deepMin: 50, lightMin: 250 });
    expect([r.from, r.to, r.intensity]).toEqual([hh(14, 30), hh(16, 30), 80]);
    expect(r.flags).toEqual(['sleep']);
  });

  it('шаг 2 без своей нормы пропускается', () => {
    expect(endurancePeak({ ...base, deepMin: 10, deepNorm: null, lightNorm: null }).flags).toEqual([]);
  });

  it('шаг 3: вариабельность −15 % и ночной пульс +5 — окно 45 минут, нагрузка 50 %', () => {
    const r = endurancePeak({ ...base, nightHrv: 42, nightPulse: 65 });
    expect(r.to - r.from).toBe(45);
    expect(r.intensity).toBe(50);
    expect(r.flags).toEqual(['overtraining']);
    // Одного признака мало.
    expect(endurancePeak({ ...base, nightHrv: 42, nightPulse: 62 }).flags).toEqual([]);
  });

  it('шаг 4: давление держится выше 140/90 — восстановительная тренировка в самый спокойный час', () => {
    const stress = new Array(24).fill(50);
    stress[10] = 12;
    const r = endurancePeak({
      ...base,
      dayPressure: [{ m: hh(9), systolic: 150, diastolic: 95 }, { m: hh(9, 30), systolic: 146, diastolic: 92 }],
      stressByHour: stress,
    });
    expect(r.kind).toBe('recovery');
    expect(r.intensity).toBe(30);
    expect(r.flags).toEqual(['biomarkers']);
    expect(r.from).toBeLessThanOrEqual(hh(10));
    expect(r.to).toBeGreaterThan(hh(10));
  });

  it('шаг 4: одиночный выброс кольца не считается — нужно полчаса–час подряд', () => {
    expect(sustained([{ m: 0, v: 93 }, { m: 30, v: 97 }, { m: 60, v: 93 }], (r) => r.v < 95)).toBe(false);
    expect(sustained([{ m: 0, v: 93 }, { m: 30, v: 94 }], (r) => r.v < 95)).toBe(true);
    // Между замерами больше часа — это не держащийся тренд.
    expect(sustained([{ m: 0, v: 93 }, { m: 120, v: 94 }], (r) => r.v < 95)).toBe(false);
    expect(endurancePeak({ ...base, glucose: [{ m: 600, v: 3.6 }, { m: 630, v: 3.8 }] }).kind).toBe('recovery');
  });

  it('шаг 5: окно не пересекает еду — встаёт после обеда и перед ужином, урезается по месту', () => {
    // Базовый режим: приёмы в 12:00 и 17:30 (по часу). Запретные зоны 10:45–14:30 и 16:15–20:30.
    const r = endurancePeak({ ...base, meals: [{ from: hh(11, 30), to: hh(12, 30) }, { from: hh(17), to: hh(18) }] });
    expect([r.from, r.to]).toEqual([hh(14, 30), hh(16, 15)]);
    expect(r.flags).toEqual(['food']);
  });

  it('шаг 5: три приёма — приоритет промежутку между обедом и ужином', () => {
    const meals = [
      { from: hh(8), to: hh(8, 30) },
      { from: hh(13), to: hh(14) },
      { from: hh(20), to: hh(21) },
    ];
    // Окно 16:00–18:00 внутри 16:00–19:15 — свободно, не двигаем.
    expect(avoidMeals({ from: hh(16), to: hh(18) }, { from: hh(7), to: hh(23) }, meals).moved).toBe(false);
    // Окно 15:00–17:00 задевает обед (до 16:00) — сдвигается в 16:00–18:00.
    expect(avoidMeals({ from: hh(15), to: hh(17) }, { from: hh(7), to: hh(23) }, meals).window).toEqual({ from: hh(16), to: hh(18) });
  });

  it('окно не выходит за конец цикла: поздний подъём', () => {
    const r = endurancePeak({ ...base, wakeMinute: hh(13), bedtimeMinute: hh(24, 30) });
    expect(r.to).toBeLessThanOrEqual(hh(24, 30));
    expect(r.to - r.from).toBe(120);
  });
});
