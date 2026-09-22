import { describe, expect, it } from 'vitest';
import {
  SLEEP_HR_BASELINE_MIN_NIGHTS,
  SLEEP_HR_PERSONAL_DEVIATION,
  sleepHrBand,
  sleepHrBaseline,
  sleepHrCheck,
} from './sleep-hr';

describe('СИНТЕТИЧЕСКИЕ: пульс во сне — возрастные границы', () => {
  it('у подростка границы выше, чем у взрослого', () => {
    expect(sleepHrBand(12)).toEqual({ min: 50, max: 95 });
    expect(sleepHrBand(15)).toEqual({ min: 48, max: 90 });
    expect(sleepHrBand(30)).toEqual({ min: 45, max: 85 });
    expect(sleepHrBand(70)).toEqual({ min: 45, max: 85 });
  });

  it('выше и ниже возрастных границ — предлагаем показать врачу', () => {
    const high = sleepHrCheck(96, 30, null);
    expect(high?.verdict).toBe('high');
    expect(high?.seeDoctor).toBe(true);
    expect(high?.text).toContain('врачу');

    const low = sleepHrCheck(41, 30, null);
    expect(low?.verdict).toBe('low');
    expect(low?.seeDoctor).toBe(true);
  });

  it('внутри границ — спокойный текст без врача', () => {
    const ok = sleepHrCheck(58, 30, null);
    expect(ok?.verdict).toBe('normal');
    expect(ok?.seeDoctor).toBe(false);
    expect(ok?.text).not.toContain('врачу');
  });
});

describe('СИНТЕТИЧЕСКИЕ: пульс во сне — своя норма', () => {
  it('норма считается по прошлым ночам, пока их хватает', () => {
    expect(sleepHrBaseline([55, 56, 57])).toBeNull();
    expect(sleepHrBaseline(new Array(SLEEP_HR_BASELINE_MIN_NIGHTS).fill(56))).toBe(56);
    expect(sleepHrBaseline([50, 52, 54, 56, 58])).toBe(54);
  });

  it('отклонение от своей нормы внутри возрастных границ — тоже повод сходить к врачу', () => {
    const baseline = 55;
    const higher = sleepHrCheck(baseline + SLEEP_HR_PERSONAL_DEVIATION, 30, baseline);
    expect(higher?.verdict).toBe('personal-high');
    expect(higher?.seeDoctor).toBe(true);
    expect(higher?.text).toContain('55');

    const lower = sleepHrCheck(baseline - SLEEP_HR_PERSONAL_DEVIATION, 30, baseline);
    expect(lower?.verdict).toBe('personal-low');
    expect(lower?.seeDoctor).toBe(true);
  });

  it('небольшая разница со своей нормой — ничего не пишем про врача', () => {
    const view = sleepHrCheck(60, 30, 55);
    expect(view?.verdict).toBe('normal');
    expect(view?.seeDoctor).toBe(false);
    expect(view?.text).toContain('55');
  });

  it('без года рождения сравниваем только со своими ночами', () => {
    expect(sleepHrCheck(58, null, null)?.verdict).toBe('plain');
    expect(sleepHrCheck(58, null, 57)?.text).toContain('57');
    expect(sleepHrCheck(72, null, 55)?.verdict).toBe('personal-high');
  });

  it('нет пульса во сне — карточки нет', () => {
    expect(sleepHrCheck(null, 30, 55)).toBeNull();
  });
});
