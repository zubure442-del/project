import { DEEP_SHARE_BEST, DEEP_SHARE_STEPS, STRESS_ZONES } from './charts';
import {
  CARDIO_REFERENCE_MIN,
  CARDIO_ZONES,
  HOUR_LOAD_HR_WEIGHT,
  HOUR_LOAD_STEPS_WEIGHT,
  HRV_TARGET,
  RESTING_HR_TARGET,
  RESTING_HR_PENALTY,
  SLEEP_TARGET_MIN,
  SLEEP_VOLUME_WEIGHT,
  STEPS_GOAL,
  STEPS_WEIGHT,
  CARDIO_WEIGHT,
  DEEP_RATIO_BEST,
  WEIGHTS,
} from './score';

const NOT_MEDICAL = 'Не медицинский показатель';

/**
 * Тексты подсказок «i». Собираются из тех же констант, что и расчёт,
 * чтобы формула на экране не разошлась с кодом.
 */
export const FORMULAS = {
  total: {
    title: 'Итог',
    lines: [
      `Сон × ${WEIGHTS.sleep} % + Активность × ${WEIGHTS.activity} % + Организм × ${WEIGHTS.state} %`,
      'Составляющая без данных исключается, веса остальных пересчитываются',
      NOT_MEDICAL,
    ],
  },
  sleep: {
    title: 'Сон',
    lines: [
      `Объём = мин / ${SLEEP_TARGET_MIN} × 100`,
      `Качество = 100 при доле глубокого ${Math.round(DEEP_RATIO_BEST.from * 100)}–${Math.round(DEEP_RATIO_BEST.to * 100)} %`,
      `Оценка = объём × ${SLEEP_VOLUME_WEIGHT} + качество × ${Math.round((1 - SLEEP_VOLUME_WEIGHT) * 100) / 100}`,
      NOT_MEDICAL,
    ],
  },
  deepShare: {
    title: 'Глубокий сон',
    lines: [
      DEEP_SHARE_STEPS.map((s) => `< ${s.below} % ${s.label}`).join(' · '),
      `≥ ${DEEP_SHARE_STEPS[DEEP_SHARE_STEPS.length - 1].below} % ${DEEP_SHARE_BEST}`,
      NOT_MEDICAL,
    ],
  },
  activity: {
    title: 'Активность',
    lines: [
      `Шаги = шаги / ${STEPS_GOAL} × 100`,
      `Кардио = очки × минуты / ${CARDIO_REFERENCE_MIN}; зоны ${CARDIO_ZONES.map((z) => Math.round(z.from * 100)).join(' / ')} % от 208 − 0,7 × возраст`,
      `Оценка = шаги × ${STEPS_WEIGHT} + кардио × ${CARDIO_WEIGHT}, не больше 100`,
      NOT_MEDICAL,
    ],
  },
  busiestHour: {
    title: 'Самый активный час',
    lines: [
      `Нагрузка = ${HOUR_LOAD_STEPS_WEIGHT} × шаги / макс + ${HOUR_LOAD_HR_WEIGHT} × очки кардио / макс`,
      `Очки: ${CARDIO_ZONES.map((z) => `> ${Math.round(z.from * 100)} % = ${z.points}`).join(' · ')}`,
      'Кольцо мерит пульс не чаще раза в 30 минут: короткая нагрузка может не попасть',
      NOT_MEDICAL,
    ],
  },
  state: {
    title: 'Организм',
    lines: [
      `Вариабельность = среднее / ${HRV_TARGET} × 100`,
      `Пульс во сне = 100 − (пульс − ${RESTING_HR_TARGET}) × ${RESTING_HR_PENALTY}`,
      'Оценка = среднее двух; нужны оба входа',
      NOT_MEDICAL,
    ],
  },
  stress: {
    title: 'Стресс',
    lines: [
      STRESS_ZONES.map((z, i) => `${i === 0 ? 0 : STRESS_ZONES[i - 1].upTo + 1}–${z.upTo} ${z.label}`).join(' · '),
      '0 — замера не было',
      NOT_MEDICAL,
    ],
  },
  hrv: {
    title: 'Вариабельность',
    lines: [`Среднее за день, мс`, `${HRV_TARGET} мс = 100 в оценке организма`, NOT_MEDICAL],
  },
  calories: {
    title: 'Калории',
    lines: ['Расход по данным кольца: шаги и профиль', 'Только за сегодня', NOT_MEDICAL],
  },
  pressure: {
    title: 'Давление',
    lines: ['Оценка кольца, мм рт. ст.', 'В итог не входит', NOT_MEDICAL],
  },
  glucose: {
    title: 'Глюкоза',
    lines: ['Оценка кольца, ммоль/л', 'В итог не входит', NOT_MEDICAL],
  },
} as const;

export type FormulaKey = keyof typeof FORMULAS;

export const formulaText = (key: FormulaKey): string => FORMULAS[key].lines.join('\n');
