import { describe, expect, it } from 'vitest';
import { DEEP_SHARE_BEST, DEEP_SHARE_STEPS, STRESS_ZONES } from './charts';
import { FORMULAS, formulaText, type FormulaKey } from './formulas';
import {
  CARDIO_REFERENCE_MIN,
  CARDIO_WEIGHT,
  DEEP_RATIO_BEST,
  HRV_TARGET,
  RESTING_HR_PENALTY,
  RESTING_HR_TARGET,
  SLEEP_TARGET_MIN,
  SLEEP_VOLUME_WEIGHT,
  STEPS_GOAL,
  STEPS_WEIGHT,
  WEIGHTS,
} from './score';

const keys = Object.keys(FORMULAS) as FormulaKey[];

describe('подсказки собираются из констант расчёта', () => {
  it('веса итога взяты из WEIGHTS', () => {
    const text = formulaText('total');
    expect(text).toContain(`${WEIGHTS.sleep} %`);
    expect(text).toContain(`${WEIGHTS.activity} %`);
    expect(text).toContain(`${WEIGHTS.state} %`);
  });

  it('сон: цель, доля глубокого и вес объёма', () => {
    const text = formulaText('sleep');
    expect(text).toContain(String(SLEEP_TARGET_MIN));
    expect(text).toContain(String(SLEEP_VOLUME_WEIGHT));
    expect(text).toContain(String(Math.round(DEEP_RATIO_BEST.from * 100)));
    expect(text).toContain(String(Math.round(DEEP_RATIO_BEST.to * 100)));
  });

  it('активность: цель по шагам и веса', () => {
    const text = formulaText('activity');
    expect(text).toContain(String(STEPS_GOAL));
    expect(text).toContain(String(STEPS_WEIGHT));
    expect(text).toContain(String(CARDIO_WEIGHT));
    expect(text).toContain(String(CARDIO_REFERENCE_MIN));
  });

  it('организм: цели вариабельности и пульса', () => {
    const text = formulaText('state');
    expect(text).toContain(String(HRV_TARGET));
    expect(text).toContain(String(RESTING_HR_TARGET));
    expect(text).toContain(String(RESTING_HR_PENALTY));
  });

  it('зоны стресса и ярлыки глубокого сна перечислены полностью', () => {
    const stress = formulaText('stress');
    for (const zone of STRESS_ZONES) {
      expect(stress).toContain(zone.label);
      expect(stress).toContain(String(zone.upTo));
    }
    const deep = formulaText('deepShare');
    for (const step of DEEP_SHARE_STEPS) {
      expect(deep).toContain(step.label);
      expect(deep).toContain(String(step.below));
    }
    expect(deep).toContain(DEEP_SHARE_BEST);
  });

  it('каждая подсказка заканчивается оговоркой и умещается в четыре строки', () => {
    for (const key of keys) {
      const lines = FORMULAS[key].lines;
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(4);
      expect(lines[lines.length - 1]).toBe('Не медицинский показатель');
    }
  });

  it('в подсказках нет пояснений для человека и упоминаний чужого приложения', () => {
    const banned = /пульсовой волне|простыми словами|официальн|неофициальн|основа —/i;
    for (const key of keys) expect(formulaText(key)).not.toMatch(banned);
  });
});
