import { coffeeClock } from './coffee';
import { median } from './food';
import { glucoseLevel } from './glucose';
import type { DayLoad } from './training';

/**
 * Наблюдения для «Мнения Лиса» (решение владельца 26.09): не пересказ цифр с экрана, а то,
 * что за ними, скорее всего, стоит в жизни человека. Приложение находит закономерности само —
 * точно и одинаково каждый раз, — а модель превращает их в живую речь Лиса. На экран эти строки
 * не выводятся: это подсказки для модели, поэтому в них можно называть показатели (глюкозу и
 * пульс), а в ответе модель говорит о привычках — перекусах, позднем ужине, долгом сидении.
 * Каждое наблюдение — сравнение со своей нормой за прошлые дни, а не с «нормой вообще».
 */

export interface MinutePoint {
  /** Минуты от полуночи. */
  m: number;
  v: number;
}

/** Подъём глюкозы — замер выше обычного уровня на столько (при уровне 6.0 — от 6.9). */
export const INSIGHT_RISE_SHARE = 0.15;
/** Подъём начинается, если предыдущий замер (не дальше 2 ч) был ниже порога. */
export const INSIGHT_RISE_GAP_MIN = 120;
/** Частые подъёмы: сегодня хотя бы столько и на столько больше обычного к этому часу. */
export const INSIGHT_RISES_MIN = 3;
export const INSIGHT_RISES_OVER = 2;
/** Поздний подъём — начался после 21:00. */
export const INSIGHT_LATE_RISE_FROM = 21 * 60;
/** Отход ко сну заметно позже или раньше обычного — от часа. */
export const INSIGHT_BEDTIME_SHIFT_MIN = 60;
/** Глубокий сон и вариабельность: отклонение от своей нормы от 25 % и 15 %. */
export const INSIGHT_DEEP_SHARE = 0.25;
export const INSIGHT_HRV_SHARE = 0.15;
/** Сон короче или длиннее обычного от 45 минут. */
export const INSIGHT_SLEEP_SHIFT_MIN = 45;
/** Пульс во сне выше своей нормы от 4 уд/мин, ниже — от 3. */
export const INSIGHT_PULSE_UP = 4;
export const INSIGHT_PULSE_DOWN = 3;
/** Темп шагов: к этому часу меньше 60 % или больше 140 % обычного; считаем с 11:00. */
export const INSIGHT_PACE_LOW = 0.6;
export const INSIGHT_PACE_HIGH = 1.4;
export const INSIGHT_PACE_FROM = 11 * 60;
/** Долго без движения — от 2.5 часов подряд днём; движение — минута от 15 шагов. */
export const INSIGHT_SIT_MIN = 150;
export const INSIGHT_MOVE_STEPS = 15;
/** Стресс днём выше обычного на столько пунктов; днём — 9:00–21:00, нужно хотя бы 4 замера. */
export const INSIGHT_STRESS_OVER = 12;
/** Вчерашняя нагрузка тяжелее привычной в столько раз. */
export const INSIGHT_LOAD_RATIO = 1.5;
/** Своя норма — если прошлых дней (ночей) хотя бы столько. */
export const INSIGHT_MIN_HISTORY = 3;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const clock = coffeeClock;
const duration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ч${m ? ` ${String(m).padStart(2, '0')} мин` : ''}` : `${m} мин`;
};
const percent = (share: number) => `${Math.round(Math.abs(share) * 100)} %`;

/** Начала подъёмов глюкозы за день (минуты): замер выше порога после замера ниже него. */
export function glucoseRises(points: readonly MinutePoint[], level: number): number[] {
  const threshold = level * (1 + INSIGHT_RISE_SHARE);
  const sorted = [...points].sort((a, b) => a.m - b.m);
  return sorted
    .filter((p, i) => {
      if (p.v < threshold) return false;
      const prev = sorted[i - 1];
      return !prev || p.m - prev.m > INSIGHT_RISE_GAP_MIN || prev.v < threshold;
    })
    .map((p) => p.m);
}

export interface InsightInput {
  /** До какой минуты сегодняшнего дня есть данные (время выгрузки); null — сегодняшних данных нет. */
  dataMinute: number | null;
  glucose: {
    today: readonly MinutePoint[];
    yesterday: readonly MinutePoint[];
    /** Семь прошлых дней, без сегодняшнего. */
    history: readonly (readonly MinutePoint[])[];
  };
  sleep: {
    /** Засыпание: минуты от полуночи дня пробуждения, вечер накануне — отрицательные. */
    asleep: number | null;
    totalMin: number | null;
    deepMin: number | null;
    /** Прошлые ночи (главный сон дня) за неделю. */
    history: readonly { asleep: number; totalMin: number; deepMin: number }[];
  };
  /** Средний пульс во сне против своей нормы, уд/мин; нормы нет — null. */
  nightPulseDelta: number | null;
  hrv: { today: number | null; history: readonly number[] };
  steps: {
    /** Шаги по минутам (сырые, как пришли с кольца). */
    today: readonly MinutePoint[];
    history: readonly (readonly MinutePoint[])[];
    /** Подъём сегодня, минуты от полуночи; нет — считаем с 7:00. */
    wake: number | null;
  };
  stress: { today: readonly MinutePoint[]; history: readonly (readonly MinutePoint[])[] };
  load: { yesterday: DayLoad | null; history: readonly DayLoad[] };
}

function glucoseInsights(input: InsightInput): string[] {
  const { today, yesterday, history } = input.glucose;
  const out: string[] = [];
  const level = glucoseLevel([...history.flat(), ...today].map((p) => p.v));
  const upTo = input.dataMinute;
  if (upTo !== null) {
    const now = glucoseRises(today.filter((p) => p.m <= upTo), level).length;
    const usual = median(
      history.filter((d) => d.length >= 12).map((d) => glucoseRises(d.filter((p) => p.m <= upTo), level).length),
    );
    if (usual !== null && now >= INSIGHT_RISES_MIN && now >= usual + INSIGHT_RISES_OVER) {
      out.push(
        `Глюкоза сегодня к ${clock(upTo)} поднималась ${now} раз, обычно к этому времени ${Math.round(usual)}: ` +
          'похоже на частые перекусы или сладкое между приёмами пищи.',
      );
    }
    const lateToday = glucoseRises(today.filter((p) => p.m <= upTo), level).filter((m) => m >= INSIGHT_LATE_RISE_FROM);
    if (lateToday.length) {
      out.push(`Сегодня в ${clock(lateToday[0])} начался подъём глюкозы: похоже на поздний ужин или перекус перед сном.`);
    }
  }
  const lateYesterday = glucoseRises(yesterday, level).filter((m) => m >= INSIGHT_LATE_RISE_FROM);
  if (lateYesterday.length) {
    out.push(`Вчера в ${clock(lateYesterday[0])} был подъём глюкозы: похоже на поздний ужин или перекус перед сном.`);
  }
  return out;
}

function sleepInsights(input: InsightInput): string[] {
  const { asleep, totalMin, deepMin, history } = input.sleep;
  const out: string[] = [];
  if (history.length < INSIGHT_MIN_HISTORY) return out;
  if (asleep !== null) {
    const usual = mean(history.map((n) => n.asleep));
    const shift = asleep - usual;
    if (Math.abs(shift) >= INSIGHT_BEDTIME_SHIFT_MIN) {
      out.push(
        `Засыпание в ${clock(asleep)} — на ${duration(Math.abs(shift))} ${shift > 0 ? 'позже' : 'раньше'} обычного (обычно около ${clock(usual)}).`,
      );
    }
  }
  if (totalMin !== null) {
    const usual = mean(history.map((n) => n.totalMin));
    if (Math.abs(totalMin - usual) >= INSIGHT_SLEEP_SHIFT_MIN) {
      out.push(`Сна ${duration(totalMin)} — ${totalMin < usual ? 'меньше' : 'больше'} обычного (обычно ${duration(usual)}).`);
    }
  }
  if (deepMin !== null) {
    const usual = mean(history.map((n) => n.deepMin));
    const share = usual > 0 ? (deepMin - usual) / usual : 0;
    if (Math.abs(share) >= INSIGHT_DEEP_SHARE) {
      out.push(
        `Глубокого сна ${duration(deepMin)} — на ${percent(share)} ${share < 0 ? 'меньше' : 'больше'} своей нормы (обычно ${duration(usual)}).`,
      );
    }
  }
  return out;
}

function recoveryInsights(input: InsightInput): string[] {
  const out: string[] = [];
  const d = input.nightPulseDelta;
  if (d !== null && d >= INSIGHT_PULSE_UP) {
    out.push(
      `Пульс во сне на ${Math.round(d)} уд/мин выше своей нормы — так бывает после поздней еды, алкоголя, ` +
        'нагрузки поздно вечером или напряжённого дня.',
    );
  } else if (d !== null && d <= -INSIGHT_PULSE_DOWN) {
    out.push(`Пульс во сне на ${Math.round(-d)} уд/мин ниже своей нормы — ночь прошла спокойно, организм хорошо восстановился.`);
  }
  const { today, history } = input.hrv;
  if (today !== null && history.length >= INSIGHT_MIN_HISTORY) {
    const usual = mean(history);
    const share = usual > 0 ? (today - usual) / usual : 0;
    if (share <= -INSIGHT_HRV_SHARE) {
      out.push(`Вариабельность ${Math.round(today)} мс — на ${percent(share)} ниже своей нормы: организм восстанавливается хуже обычного.`);
    } else if (share >= INSIGHT_HRV_SHARE) {
      out.push(`Вариабельность ${Math.round(today)} мс — на ${percent(share)} выше своей нормы: хороший запас сил.`);
    }
  }
  const { yesterday, history: loads } = input.load;
  if (yesterday && loads.length >= 7) {
    const usual = mean(loads.map((l) => l.trimp));
    const kind = yesterday.session === 'cardio' ? ', была кардиотренировка' : yesterday.session === 'strength' ? ', была силовая тренировка' : '';
    if (usual > 0 && yesterday.trimp >= INSIGHT_LOAD_RATIO * usual) {
      out.push(`Вчера нагрузка была в ${(yesterday.trimp / usual).toFixed(1).replace('.', ',')} раза выше привычной${kind}.`);
    } else if (kind) {
      out.push(`Вчера${kind}.`);
    }
  }
  return out;
}

function movementInsights(input: InsightInput): string[] {
  const out: string[] = [];
  const upTo = input.dataMinute;
  if (upTo === null) return out;
  const { today, history, wake } = input.steps;
  const upToNow = (day: readonly MinutePoint[]) => day.filter((p) => p.m <= upTo).reduce((sum, p) => sum + p.v, 0);

  if (upTo >= INSIGHT_PACE_FROM) {
    const active = history.filter((d) => d.reduce((sum, p) => sum + p.v, 0) >= 1000);
    if (active.length >= INSIGHT_MIN_HISTORY) {
      const usual = mean(active.map(upToNow));
      const ratio = usual > 0 ? upToNow(today) / usual : 1;
      if (ratio <= INSIGHT_PACE_LOW) {
        out.push(`К ${clock(upTo)} шагов примерно ${percent(ratio)} от того, что обычно набирается к этому часу: день малоподвижнее обычного.`);
      } else if (ratio >= INSIGHT_PACE_HIGH) {
        out.push(`К ${clock(upTo)} шагов примерно в ${ratio.toFixed(1).replace('.', ',')} раза больше, чем обычно к этому часу.`);
      }
    }
  }

  // Самый долгий отрезок без движения днём: от подъёма (не раньше 7:00) до времени данных.
  const from = Math.max(wake ?? 7 * 60, 7 * 60);
  const moves = today.filter((p) => p.v >= INSIGHT_MOVE_STEPS && p.m >= from && p.m <= upTo).map((p) => p.m).sort((a, b) => a - b);
  const marks = [from, ...moves, upTo];
  let best = { from: 0, to: 0 };
  for (let i = 1; i < marks.length; i++) {
    if (marks[i] - marks[i - 1] > best.to - best.from) best = { from: marks[i - 1], to: marks[i] };
  }
  if (moves.length && best.to - best.from >= INSIGHT_SIT_MIN) {
    const tillNow = best.to === upTo;
    out.push(
      `С ${clock(best.from)} ${tillNow ? `и до ${clock(upTo)}` : `до ${clock(best.to)}`} почти не было шагов — ` +
        `${duration(best.to - best.from)} без движения: похоже на долгое сидение.`,
    );
  }
  return out;
}

function stressInsights(input: InsightInput): string[] {
  const upTo = input.dataMinute;
  if (upTo === null) return [];
  const day = (points: readonly MinutePoint[], to: number) => points.filter((p) => p.m >= 9 * 60 && p.m <= to);
  const today = day(input.stress.today, Math.min(upTo, 21 * 60));
  const past = input.stress.history.map((d) => day(d, 21 * 60)).filter((d) => d.length >= 4);
  if (today.length < 4 || past.length < INSIGHT_MIN_HISTORY) return [];
  const now = mean(today.map((p) => p.v));
  const usual = mean(past.map((d) => mean(d.map((p) => p.v))));
  if (now - usual < INSIGHT_STRESS_OVER) return [];
  const peak = today.reduce((a, b) => (b.v > a.v ? b : a));
  return [`Стресс днём выше обычного: в среднем ${Math.round(now)} против обычных ${Math.round(usual)}, пик около ${clock(Math.floor(peak.m / 60) * 60)}.`];
}

/** Не больше стольких наблюдений: модель выберет одно-два самых интересных. */
export const INSIGHT_MAX = 6;

/** Наблюдения дня по порядку: сон и восстановление, движение, еда, стресс. */
export function dayInsights(input: InsightInput): string[] {
  return [
    ...sleepInsights(input),
    ...recoveryInsights(input),
    ...movementInsights(input),
    ...glucoseInsights(input),
    ...stressInsights(input),
  ].slice(0, INSIGHT_MAX);
}
