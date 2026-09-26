import { sleepMinutes, type SleepSession } from './sleep';

/**
 * Циклы бодрствования вместо календарных суток — для аналитики (итог, сон, активность, организм).
 * Цикл начинается с полноценного пробуждения и кончается засыпанием на следующий полноценный сон.
 * Простые счётчики (шаги, калории, дистанция) по-прежнему считаются по календарным суткам.
 * Все метки — кольцевые секунды (настенное время, см. codec/time.ts).
 */

/** Полноценный сон — сессия, где сна больше этого (минуты). Короче — дрёма, цикл она не рвёт. */
export const FULL_SLEEP_MIN = 30;
/** Цикл не длиннее этого (часы от начала): дальше он закрывается по таймауту. */
export const CYCLE_MAX_HOURS = 28;
/**
 * Кольцо снято (или на зарядке): столько минут подряд нет ни одного замера — ни пульса,
 * ни кислорода, ни давления со стрессом. Автозамер идёт раз в 15–30 минут, 3 часа — это 6–12 пропусков.
 * Время суток не важно: кольцо могут поставить на зарядку и днём.
 */
export const OFF_BODY_GAP_MIN = 180;

/** Чем начался цикл: пробуждение, таймаут 28 часов, кольцо снова на руке, начало данных. */
export type CycleStart = 'wake' | 'timeout' | 'offBody' | 'first';
/** Чем кончился: засыпание, таймаут 28 часов, кольцо сняли. */
export type CycleEnd = 'sleep' | 'timeout' | 'offBody';

export interface WakeCycle {
  start: number;
  /** null — цикл идёт сейчас. */
  end: number | null;
  startedBy: CycleStart;
  endedBy: CycleEnd | null;
  /** Сон, после которого начался цикл (только у 'wake'). */
  sleep: SleepSession | null;
  /** Что было перед циклом: сон или время без кольца. У 'first' и 'timeout' — null. */
  before: { from: number; to: number } | null;
}

export interface CyclesResult {
  cycles: WakeCycle[];
  /** Кольцо снято сейчас: с этого момента нет ни одного замера. Текущего цикла тогда нет. */
  ringOffSince: number | null;
}

export interface OffBodyGap {
  from: number;
  /** null — кольца нет до сих пор. */
  to: number | null;
}

/** Промежутки без замеров дольше OFF_BODY_GAP_MIN. `horizon` — до какого момента данные есть (время выгрузки). */
export function offBodyGaps(measurements: readonly number[], horizon: number): OffBodyGap[] {
  const ts = [...new Set(measurements)].sort((a, b) => a - b);
  const limit = OFF_BODY_GAP_MIN * 60;
  const out: OffBodyGap[] = [];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] > limit) out.push({ from: ts[i - 1], to: ts[i] });
  }
  const last = ts[ts.length - 1];
  if (last !== undefined && horizon - last > limit) out.push({ from: last, to: null });
  return out;
}

const overlap = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));

interface Block {
  from: number;
  to: number;
  /** Кольцо так и не надели: блок тянется до конца данных. */
  open: boolean;
  /** Чем блок начался и чем кончился: сон или время без кольца. */
  first: 'sleep' | 'off';
  last: 'sleep' | 'off';
  /** Последний полноценный сон блока. */
  sleep: SleepSession | null;
}

/**
 * Делит время на циклы бодрствования.
 * - «Не бодрствует» — полноценный сон (больше FULL_SLEEP_MIN) или время без кольца (OFF_BODY_GAP_MIN).
 *   Сон, который больше чем наполовину лежит во времени без замеров, — это лежащее кольцо, а не сон.
 * - Цикл — время между такими промежутками. Если промежуток кончился сном — цикл начат
 *   пробуждением ('wake'), если временем без кольца — 'offBody': сна и организма за пропуск нет.
 * - Цикл длиннее CYCLE_MAX_HOURS закрывается по таймауту, остаток — новый цикл 'timeout' без сна.
 * `dataStart` — первая метка данных, `horizon` — момент, до которого данные есть.
 */
export function buildCycles(input: {
  sessions: readonly SleepSession[];
  measurements: readonly number[];
  dataStart: number | null;
  horizon: number;
}): CyclesResult {
  const { horizon } = input;
  const gaps = offBodyGaps(input.measurements, horizon);
  const offs = gaps.map((g) => ({ from: g.from, to: g.to ?? horizon, open: g.to === null }));
  const sleeps = input.sessions
    .filter((s) => sleepMinutes(s) > FULL_SLEEP_MIN)
    .filter((s) => {
      const span = { from: s.start, to: s.end };
      const inside = offs.reduce((sum, g) => sum + overlap(span, g), 0);
      return inside * 2 <= Math.max(1, s.end - s.start);
    });

  const items = [
    ...sleeps.map((s) => ({ from: s.start, to: s.end, kind: 'sleep' as const, sleep: s, open: false })),
    ...offs.map((g) => ({ from: g.from, to: g.to, kind: 'off' as const, sleep: null, open: g.open })),
  ].sort((a, b) => a.from - b.from || a.to - b.to);

  const blocks: Block[] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (last && item.from <= last.to) {
      if (item.to >= last.to) {
        last.to = item.to;
        last.last = item.kind;
      }
      last.open ||= item.open;
      if (item.sleep) last.sleep = item.sleep;
    } else {
      blocks.push({ from: item.from, to: item.to, open: item.open, first: item.kind, last: item.kind, sleep: item.sleep });
    }
  }

  const cycles: WakeCycle[] = [];
  const maxSec = CYCLE_MAX_HOURS * 3600;
  /** Бодрствование от `from` до `to` (null — до сих пор), с разбиением по таймауту. */
  const awake = (from: number, to: number | null, startedBy: CycleStart, sleep: SleepSession | null, before: WakeCycle['before'], endedBy: CycleEnd | null) => {
    let start = from;
    let by = startedBy;
    let session = sleep;
    let prior = before;
    const until = to ?? horizon;
    while (until - start > maxSec) {
      cycles.push({ start, end: start + maxSec, startedBy: by, endedBy: 'timeout', sleep: session, before: prior });
      start += maxSec;
      by = 'timeout';
      session = null;
      prior = null;
    }
    if (to === null) cycles.push({ start, end: null, startedBy: by, endedBy: null, sleep: session, before: prior });
    else if (to > start) cycles.push({ start, end: to, startedBy: by, endedBy, sleep: session, before: prior });
  };

  const endReason = (b: Block): CycleEnd => (b.first === 'sleep' ? 'sleep' : 'offBody');
  const startReason = (b: Block): CycleStart => (b.last === 'sleep' ? 'wake' : 'offBody');
  const sleepOf = (b: Block) => (b.last === 'sleep' ? b.sleep : null);

  if (input.dataStart !== null && (!blocks.length || input.dataStart < blocks[0].from)) {
    const first = blocks[0];
    awake(input.dataStart, first ? first.from : null, 'first', null, null, first ? endReason(first) : null);
  }
  blocks.forEach((b, i) => {
    if (b.open) return;
    const next = blocks[i + 1];
    awake(b.to, next ? next.from : null, startReason(b), sleepOf(b), { from: b.from, to: b.to }, next ? endReason(next) : null);
  });

  const lastBlock = blocks[blocks.length - 1];
  return { cycles, ringOffSince: lastBlock?.open ? lastBlock.from : null };
}
