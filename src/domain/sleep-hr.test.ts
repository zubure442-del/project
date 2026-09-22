import { describe, expect, it } from 'vitest';
import {
  SLEEP_HR_BASELINE_MIN_NIGHTS,
  SLEEP_HR_PERSONAL_DEVIATION,
  SLEEP_HR_TEXT,
  sleepHrBand,
  sleepHrBaseline,
  sleepHrCheck,
} from './sleep-hr';

describe('СИНТЕТИЧЕСКИЕ: пульс во сне — сначала своя норма', () => {
  const baseline = 55;

  it('норма считается по всем ночам, пока их хватает', () => {
    expect(sleepHrBaseline([55, 56, 57])).toBeNull();
    expect(sleepHrBaseline(new Array(SLEEP_HR_BASELINE_MIN_NIGHTS).fill(56))).toBe(56);
    expect(sleepHrBaseline([50, 52, 54, 56, 58])).toBe(54);
  });

  it('отклонение от своей нормы — предлагаем проконсультироваться', () => {
    const higher = sleepHrCheck(baseline + SLEEP_HR_PERSONAL_DEVIATION, 30, baseline);
    expect(higher?.verdict).toBe('above');
    expect(higher?.text).toBe(SLEEP_HR_TEXT.above);
    expect(higher?.seeDoctor).toBe(true);

    const lower = sleepHrCheck(baseline - SLEEP_HR_PERSONAL_DEVIATION, 30, baseline);
    expect(lower?.verdict).toBe('below');
    expect(lower?.text).toBe(SLEEP_HR_TEXT.below);
  });

  it('рядом со своей нормой — короткое «Пульс в норме»', () => {
    const view = sleepHrCheck(60, 30, baseline);
    expect(view?.verdict).toBe('normal');
    expect(view?.text).toBe(SLEEP_HR_TEXT.normal);
    expect(view?.seeDoctor).toBe(false);
  });
});

describe('СИНТЕТИЧЕСКИЕ: пульс во сне — возраст как вторая проверка', () => {
  it('у подростка границы выше, чем у взрослого', () => {
    expect(sleepHrBand(12)).toEqual({ min: 50, max: 95 });
    expect(sleepHrBand(15)).toEqual({ min: 48, max: 90 });
    expect(sleepHrBand(30)).toEqual({ min: 45, max: 85 });
    expect(sleepHrBand(70)).toEqual({ min: 45, max: 85 });
  });

  it('своей нормы ещё нет — смотрим на возрастные границы', () => {
    expect(sleepHrCheck(96, 30, null)?.verdict).toBe('above');
    expect(sleepHrCheck(41, 30, null)?.verdict).toBe('below');
    expect(sleepHrCheck(58, 30, null)?.verdict).toBe('normal');
  });

  it('стабильно высокий пульс: своя норма рядом, но границы возраста перейдены', () => {
    expect(sleepHrCheck(92, 30, 90)?.verdict).toBe('above');
  });

  it('ни нормы, ни года рождения — вывода нет', () => {
    const view = sleepHrCheck(58, null, null);
    expect(view?.verdict).toBe('unknown');
    expect(view?.text).toBe(SLEEP_HR_TEXT.unknown);
    expect(view?.seeDoctor).toBe(false);
  });

  it('нет пульса во сне — карточки нет', () => {
    expect(sleepHrCheck(null, 30, 55)).toBeNull();
  });
});
