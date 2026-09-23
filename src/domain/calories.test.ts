import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, EMPTY_STATE } from '../storage';
import { rebuildDays } from '../state/sync-plan';
import {
  ACTIVITY_CORRIDOR,
  ACTIVITY_LEVEL_TEXT,
  activeCalories,
  activityLevel,
  bmr,
  bodyOf,
  heartByMinute,
  kcalPerStep,
  keytel,
  weekActivityLevel,
  weekCalories,
  type Body,
} from './calories';

const NOW = new Date(2026, 8, 21, 13, 0);
const man = bodyOf({ sex: 'male', heightCm: 175, weightKg: 70, birthYear: 1996 }, NOW) as Body;
const woman = bodyOf({ sex: 'female', heightCm: 165, weightKg: 60, birthYear: 1996 }, NOW) as Body;
const minutes = (from: number, count: number, v: number) => Array.from({ length: count }, (_, i) => ({ m: from + i, v }));

describe('СИНТЕТИЧЕСКИЕ: калории', () => {
  it('базовый обмен Mifflin–St Jeor для контрольных профилей', () => {
    expect(man.age).toBe(30);
    expect(bmr(man)).toBeCloseTo(1648.75);
    expect(bmr(woman)).toBeCloseTo(1320.25);
  });

  it('только шаги, без пульса: шаги × ккал на шаг', () => {
    // 0.75 × 70 × (0.415 × 1.75) / 1000 = 0.0381 ккал на шаг; 1 000 шагов → 38 ккал
    expect(kcalPerStep(man)).toBeCloseTo(0.03813, 4);
    expect(activeCalories(minutes(600, 10, 100), [], man)).toBe(38);
  });

  it('повышенный пульс без шагов: Keytel минус базовый обмен на минуту', () => {
    const perMin = keytel(man, 140) - bmr(man) / 1440; // ≈ 11.57 ккал/мин
    // Замеры в 10:00 и 10:10 — между ними пульс тянется линейно: 11 минут.
    expect(activeCalories([], [{ m: 600, v: 140 }, { m: 610, v: 140 }], man)).toBe(Math.round(perMin * 11));
  });

  it('пульс ниже порога не даёт калорий', () => {
    expect(activeCalories([], [{ m: 600, v: 80 }, { m: 610, v: 85 }], man)).toBe(0);
  });

  it('пульс и шаги в одну минуту — берётся большее, без суммы', () => {
    const heart = [{ m: 600, v: 140 }, { m: 610, v: 140 }];
    const both = activeCalories(minutes(600, 11, 100), heart, man) as number;
    expect(both).toBe(activeCalories([], heart, man));
    expect(both).toBeLessThan((activeCalories([], heart, man) as number) + (activeCalories(minutes(600, 11, 100), [], man) as number));
  });

  it('между замерами пульса больше 20 минут пульс не придумываем', () => {
    expect(heartByMinute([{ m: 600, v: 140 }, { m: 650, v: 140 }]).size).toBe(2);
    expect(heartByMinute([{ m: 600, v: 100 }, { m: 620, v: 120 }]).get(610)).toBeCloseTo(110);
    const perMin = keytel(man, 140) - bmr(man) / 1440;
    expect(activeCalories([], [{ m: 600, v: 140 }, { m: 650, v: 140 }], man)).toBe(Math.round(perMin * 2));
  });

  it('нет биометрии — калории не считаем, умолчаний нет', () => {
    expect(bodyOf({ ...EMPTY_PROFILE, sex: 'male', heightCm: 180, weightKg: 80 }, NOW)).toBeNull();
    expect(activeCalories(minutes(600, 10, 100), [], null)).toBeNull();
    const raw = { '2026-09-21': { date: '2026-09-21', steps: [[600, 100]] as [number, number][], sleep: [], heart: [], summary: [], spo2: [] } };
    expect(rebuildDays({ ...EMPTY_STATE, raw }, NOW).days[0].calories).toBeNull();
    const profile = { ...EMPTY_PROFILE, sex: 'male' as const, heightCm: 175, weightKg: 70, birthYear: 1996 };
    expect(rebuildDays({ ...EMPTY_STATE, raw, profile }, NOW).days[0].calories).toBe(4);
  });

  it('сумма за неделю: дни без данных не учитываются', () => {
    expect(weekCalories([120, null, 300, null, 80])).toBe(500);
    expect(weekCalories([null, null])).toBeNull();
  });
});

describe('СИНТЕТИЧЕСКИЕ: оценка недели по коридору активных калорий', () => {
  // Мужчина 30 лет, 180 см, 80 кг: BMR = 800 + 1125 − 150 + 5 = 1780 ккал.
  const body = { sex: 'male' as const, heightCm: 180, weightKg: 80, age: 30 };

  it('базовый обмен по Mifflin–St Jeor', () => {
    expect(bmr(body)).toBe(1780);
    expect(bmr({ ...body, sex: 'female' })).toBe(1780 - 5 - 161);
  });

  it('похудение: коридор 30–45 % базового обмена', () => {
    const { from, to } = ACTIVITY_CORRIDOR.lose;
    expect([from, to]).toEqual([0.3, 0.45]);
    expect(activityLevel(1780 * 0.29, body, 'lose')).toBe('low');
    expect(activityLevel(1780 * 0.3, body, 'lose')).toBe('ideal');
    expect(activityLevel(1780 * 0.45, body, 'lose')).toBe('ideal');
    expect(activityLevel(1780 * 0.5, body, 'lose')).toBe('high');
  });

  it('поддержание 20–35 %, набор массы 15–25 %', () => {
    expect(activityLevel(1780 * 0.25, body, 'keep')).toBe('ideal');
    expect(activityLevel(1780 * 0.4, body, 'keep')).toBe('high');
    expect(activityLevel(1780 * 0.1, body, 'gain')).toBe('low');
    expect(activityLevel(1780 * 0.2, body, 'gain')).toBe('ideal');
    expect(activityLevel(1780 * 0.3, body, 'gain')).toBe('high');
  });

  it('перебор оценивается так же строго, как недобор', () => {
    expect(ACTIVITY_LEVEL_TEXT.low).toBe('Низкая активность');
    expect(ACTIVITY_LEVEL_TEXT.high).toBe('Высокая активность');
    expect(ACTIVITY_LEVEL_TEXT.ideal).toBe('Идеальная активность');
  });

  it('неделя считается по завершённым дням: сегодняшний в среднее не входит', () => {
    const today = '2026-09-21';
    // Коридор «поддержания» для этого тела — 356…623 ккал в день.
    const days = [
      { date: '2026-09-19', value: 500 },
      { date: '2026-09-20', value: 500 },
      { date: today, value: 30 }, // день ещё идёт
    ];
    expect(weekActivityLevel({ days, today, body, goal: 'keep' })).toBe('ideal');
  });

  it('нет биометрии, цели или завершённых дней — оценки нет', () => {
    const today = '2026-09-21';
    const days = [{ date: '2026-09-20', value: 500 }];
    expect(weekActivityLevel({ days, today, body: null, goal: 'keep' })).toBeNull();
    expect(weekActivityLevel({ days, today, body, goal: null })).toBeNull();
    expect(weekActivityLevel({ days: [{ date: today, value: 500 }], today, body, goal: 'keep' })).toBeNull();
    expect(weekActivityLevel({ days: [{ date: '2026-09-20', value: null }], today, body, goal: 'keep' })).toBeNull();
  });
});
