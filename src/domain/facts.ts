import { coffeeClock } from './coffee';
import { median } from './food';
import { glucoseLevel } from './glucose';
import { formatCount } from './texts';
import type { DayLoad } from './training';

/**
 * Факты дня для «Мнения Лиса» (решение владельца 26.09): прозрачные исходные данные, а не готовые
 * выводы. Каждая строка — «сегодня против обычного для этого человека» с разницей, без объяснений
 * «почему» и без советов: найти необычное и догадаться, что за ним стоит, должна сама модель.
 * Обычное — своя норма за прошлые 7 дней (ночей), если их хотя бы три; иначе только «сегодня».
 * На экран эти строки не выводятся; «сегодня» — до времени последней выгрузки.
 */

export interface MinutePoint {
  /** Минуты от полуночи. */
  m: number;
  v: number;
}

/** Подъём глюкозы — замер выше обычного уровня на столько (при уровне 6.0 — от 6.9). */
export const FACT_RISE_SHARE = 0.15;
/** Подъём начинается, если предыдущий замер (не дальше 2 ч) был ниже порога. */
export const FACT_RISE_GAP_MIN = 120;
/** Своя норма — если прошлых дней (ночей) хотя бы столько. */
export const FACT_MIN_HISTORY = 3;
/** Минута «с движением» — от стольких шагов; отрезок без шагов показываем от часа. */
export const FACT_MOVE_STEPS = 15;
export const FACT_STILL_MIN = 60;
/** Разница меньше этого — «как обычно» (минуты для времени, уд/мин для пульса и т. п. — своя у каждого факта). */
export const FACT_SAME_MIN = 15;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const usual = (values: readonly number[]) => (values.length >= FACT_MIN_HISTORY ? mean(values) : null);
const clock = coffeeClock;
const count = formatCount;
const duration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ч${m ? ` ${String(m).padStart(2, '0')} мин` : ''}` : `${m} мин`;
};
const one = (n: number) => n.toFixed(1).replace('.', ',');

/** «(обычно 23:50, на 1 ч 20 мин позже)» — для времени суток. */
const vsClock = (today: number, norm: number | null) => {
  if (norm === null) return '';
  const d = today - norm;
  const diff = Math.abs(d) < FACT_SAME_MIN ? 'как обычно' : `на ${duration(Math.abs(d))} ${d > 0 ? 'позже' : 'раньше'}`;
  return ` (обычно ${clock(norm)}, ${diff})`;
};
/** «(обычно 1 ч 20 мин, на 30 мин меньше)» — для длительности. */
const vsDuration = (today: number, norm: number | null) => {
  if (norm === null) return '';
  const d = today - norm;
  const diff = Math.abs(d) < FACT_SAME_MIN ? 'как обычно' : `на ${duration(Math.abs(d))} ${d > 0 ? 'больше' : 'меньше'}`;
  return ` (обычно ${duration(norm)}, ${diff})`;
};
/** «(обычно 48)» — для чисел. */
const vsNumber = (norm: number | null, unit = '') => (norm === null ? '' : ` (обычно ${Math.round(norm)}${unit})`);

/** Начала подъёмов глюкозы за день (минуты): замер выше порога после замера ниже него. */
export function glucoseRises(points: readonly MinutePoint[], level: number): number[] {
  const threshold = level * (1 + FACT_RISE_SHARE);
  const sorted = [...points].sort((a, b) => a.m - b.m);
  return sorted
    .filter((p, i) => {
      if (p.v < threshold) return false;
      const prev = sorted[i - 1];
      return !prev || p.m - prev.m > FACT_RISE_GAP_MIN || prev.v < threshold;
    })
    .map((p) => p.m);
}

export interface FactsInput {
  /** До какой минуты сегодняшнего дня есть данные (время выгрузки); null — сегодняшних данных нет. */
  dataMinute: number | null;
  sleep: {
    /** Засыпание и подъём: минуты от полуночи дня пробуждения, вечер накануне — отрицательные. */
    asleep: number | null;
    awake: number | null;
    totalMin: number | null;
    deepMin: number | null;
    /** Главный сон каждого из прошлых дней недели. */
    history: readonly { asleep: number; awake: number; totalMin: number; deepMin: number }[];
  };
  /** Пульс во сне и своя норма (norm — null, пока ночей мало). */
  nightPulse: { min: number; avg: number; norm: { min: number; avg: number } | null } | null;
  hrv: { today: number | null; history: readonly number[] };
  restingPulse: { today: number | null; history: readonly number[] };
  spo2: { today: number | null; history: readonly number[] };
  steps: {
    /** Шаги по минутам (сырые, как пришли с кольца). */
    today: readonly MinutePoint[];
    history: readonly (readonly MinutePoint[])[];
    /** Подъём сегодня, минуты от полуночи; нет — считаем с 7:00. */
    wake: number | null;
  };
  stress: { today: readonly MinutePoint[]; history: readonly (readonly MinutePoint[])[] };
  glucose: {
    today: readonly MinutePoint[];
    yesterday: readonly MinutePoint[];
    /** Семь прошлых дней, без сегодняшнего. */
    history: readonly (readonly MinutePoint[])[];
  };
  yesterday: {
    /** Шаги после шумоподавления и норма шагов — как на экране. */
    steps: number | null;
    norm: number | null;
    load: DayLoad | null;
    /** Нагрузки дней до вчера (до четырёх недель): из них «обычная». */
    history: readonly DayLoad[];
  };
}

function sleepFacts({ sleep: s }: FactsInput): string[] {
  const parts: string[] = [];
  if (s.asleep !== null) parts.push(`засыпание ${clock(s.asleep)}${vsClock(s.asleep, usual(s.history.map((n) => n.asleep)))}`);
  if (s.awake !== null) parts.push(`подъём ${clock(s.awake)}${vsClock(s.awake, usual(s.history.map((n) => n.awake)))}`);
  if (s.totalMin !== null) parts.push(`сна всего ${duration(s.totalMin)}${vsDuration(s.totalMin, usual(s.history.map((n) => n.totalMin)))}`);
  if (s.deepMin !== null) parts.push(`глубокого ${duration(s.deepMin)}${vsDuration(s.deepMin, usual(s.history.map((n) => n.deepMin)))}`);
  return parts.length ? [`Сон прошлой ночи: ${parts.join('; ')}.`] : [];
}

function bodyFacts(input: FactsInput): string[] {
  const out: string[] = [];
  const p = input.nightPulse;
  if (p) {
    out.push(
      `Пульс во сне: средний ${p.avg}${p.norm ? ` (обычно ${p.norm.avg})` : ''}, ` +
        `минимальный ${p.min}${p.norm ? ` (обычно ${p.norm.min})` : ''}.`,
    );
  }
  const { hrv, restingPulse, spo2 } = input;
  if (hrv.today !== null) out.push(`Вариабельность за день: ${Math.round(hrv.today)} мс${vsNumber(usual(hrv.history), ' мс')}.`);
  if (restingPulse.today !== null) out.push(`Пульс покоя: ${Math.round(restingPulse.today)}${vsNumber(usual(restingPulse.history))}.`);
  if (spo2.today !== null) out.push(`Кислород: ${Math.round(spo2.today)} %${vsNumber(usual(spo2.history), ' %')}.`);
  return out;
}

function yesterdayFacts({ yesterday: y }: FactsInput): string[] {
  const parts: string[] = [];
  if (y.steps !== null) parts.push(`${count(y.steps)} шагов${y.norm !== null ? ` при норме ${count(y.norm)}` : ''}`);
  if (y.load) {
    const norm = y.history.length >= 7 ? mean(y.history.map((l) => l.trimp)) : null;
    if (norm !== null && norm > 0) parts.push(`нагрузка по пульсу ${one(y.load.trimp / norm)} от обычной`);
    parts.push(
      y.load.session === 'cardio'
        ? 'была кардиотренировка'
        : y.load.session === 'strength'
          ? 'была силовая тренировка'
          : 'тренировки не было',
    );
  }
  return parts.length ? [`Вчера: ${parts.join('; ')}.`] : [];
}

function movementFacts(input: FactsInput): string[] {
  const upTo = input.dataMinute;
  if (upTo === null) return [];
  const { today, history, wake } = input.steps;
  const from = Math.max(wake ?? 7 * 60, 7 * 60);
  if (upTo <= from) return [];
  const out: string[] = [];

  // Шаги по часам — как есть, от подъёма до времени данных.
  const hours: string[] = [];
  for (let h = Math.floor(from / 60); h * 60 <= upTo; h++) {
    const sum = today.filter((p) => p.m >= h * 60 && p.m < (h + 1) * 60 && p.m <= upTo).reduce((a, p) => a + p.v, 0);
    hours.push(`${h} ч — ${count(sum)}`);
  }
  out.push(`Шаги сегодня по часам: ${hours.join(', ')}.`);

  const upToNow = (day: readonly MinutePoint[]) => day.filter((p) => p.m <= upTo).reduce((sum, p) => sum + p.v, 0);
  const active = history.filter((d) => d.reduce((sum, p) => sum + p.v, 0) >= 1000);
  if (active.length >= FACT_MIN_HISTORY) {
    const norm = mean(active.map(upToNow));
    if (norm > 0) out.push(`К ${clock(upTo)} шагов ${Math.round((upToNow(today) / norm) * 100)} % от обычного к этому часу.`);
  }

  // Самый долгий отрезок без шагов от подъёма до времени данных.
  const moves = today.filter((p) => p.v >= FACT_MOVE_STEPS && p.m >= from && p.m <= upTo).map((p) => p.m).sort((a, b) => a - b);
  if (moves.length) {
    const marks = [from, ...moves, upTo];
    let best = { from: 0, to: 0 };
    for (let i = 1; i < marks.length; i++) {
      if (marks[i] - marks[i - 1] > best.to - best.from) best = { from: marks[i - 1], to: marks[i] };
    }
    if (best.to - best.from >= FACT_STILL_MIN) {
      out.push(`Самый долгий отрезок без шагов: ${clock(best.from)}–${clock(best.to)} (${duration(best.to - best.from)}).`);
    }
  }
  return out;
}

function stressFacts(input: FactsInput): string[] {
  const upTo = input.dataMinute;
  if (upTo === null) return [];
  const day = (points: readonly MinutePoint[], to: number) => points.filter((p) => p.m >= 9 * 60 && p.m <= to);
  const today = day(input.stress.today, Math.min(upTo, 21 * 60));
  if (today.length < 2) return [];
  const past = input.stress.history.map((d) => day(d, 21 * 60)).filter((d) => d.length >= 4);
  const peak = today.reduce((a, b) => (b.v > a.v ? b : a));
  return [
    `Стресс днём (шкала 0–100): в среднем ${Math.round(mean(today.map((p) => p.v)))}` +
      `${vsNumber(usual(past.map((d) => mean(d.map((p) => p.v)))))}, самый высокий ${Math.round(peak.v)} около ${clock(Math.floor(peak.m / 60) * 60)}.`,
  ];
}

function glucoseFacts(input: FactsInput): string[] {
  const { today, yesterday, history } = input.glucose;
  const out: string[] = [];
  const level = glucoseLevel([...history.flat(), ...today].map((p) => p.v));
  const upTo = input.dataMinute;
  if (upTo !== null && today.length) {
    const rises = glucoseRises(today.filter((p) => p.m <= upTo), level);
    const norm = median(
      history.filter((d) => d.length >= 12).map((d) => glucoseRises(d.filter((p) => p.m <= upTo), level).length),
    );
    const typical = norm !== null && history.filter((d) => d.length >= 12).length >= FACT_MIN_HISTORY ? ` (обычно к этому часу ${one(norm)})` : '';
    out.push(
      rises.length
        ? `Подъёмы глюкозы сегодня: ${rises.map(clock).join(', ')} — ${rises.length}${typical}.`
        : `Подъёмов глюкозы сегодня не было${typical}.`,
    );
  }
  if (yesterday.length) {
    const rises = glucoseRises(yesterday, level);
    out.push(rises.length ? `Подъёмы глюкозы вчера: ${rises.map(clock).join(', ')}.` : 'Подъёмов глюкозы вчера не было.');
  }
  return out;
}

/** Не больше стольких строк: хватит, чтобы увидеть день целиком, и запрос не разрастается. */
export const FACTS_MAX = 12;

/** Факты дня по порядку: сон, тело, вчера, движение, стресс, еда. */
export function dayFacts(input: FactsInput): string[] {
  return [
    ...sleepFacts(input),
    ...bodyFacts(input),
    ...yesterdayFacts(input),
    ...movementFacts(input),
    ...stressFacts(input),
    ...glucoseFacts(input),
  ].slice(0, FACTS_MAX);
}
