/**
 * «Эстафета»: дневная норма шагов, орехи и серия (огонёк).
 *
 * - День выполнен, если шаги дня после шумоподавления не меньше нормы шагов этого дня.
 * - За выполненный день — RELAY_DAY_REWARD орехов. Начисляется при открытии приложения по кэшу
 *   и только за прошедшие дни: сегодняшний день ещё идёт, на «Сегодня» для него только
 *   «Осталось N шагов» или «Зелёный свет». Каждый день начисляется один раз (пометка `credited`).
 * - Серия — дни подряд с выполненной нормой. Пропуск (день без нормы или без данных) обнуляет её.
 * - Лестница бонусов за серию: при достижении ступени — её сумма, один раз за серию и без сложения
 *   со ступенями ниже (на 30-й день — 500, а не 50 + 500). Обнулилась серия — лестница заново.
 *
 * Невыполненный день нигде не записывается: если полные шаги вчерашнего дня придут позже
 * (вчера синхронизировались вечером, а норму добрали к полуночи), он засчитается и серия продолжится.
 */

/** Орехов за день с выполненной нормой. */
export const RELAY_DAY_REWARD = 5;

/** Лестница бонусов за серию: дней подряд → орехов. */
export const STREAK_LADDER = [
  { days: 7, nuts: 50 },
  { days: 30, nuts: 500 },
  { days: 60, nuts: 2000 },
  { days: 120, nuts: 5000 },
  { days: 365, nuts: 30000 },
] as const;

/** Сколько последних пометок «начислено» храним: дальше дни из кэша уже не вернутся. */
export const RELAY_CREDITED_KEEP = 60;

/** Счёт «Эстафеты». Живёт только на телефоне, вместе с остальным состоянием. */
export interface RelayLedger {
  /** Баланс орехов. */
  nuts: number;
  /** Дни, за которые RELAY_DAY_REWARD уже начислено: чтобы не задвоить. */
  credited: string[];
  /** Длина серии, закончившейся днём `lastMetDate`. */
  streak: number;
  /** Последний засчитанный день с выполненной нормой. */
  lastMetDate: string | null;
  /** Ступени лестницы (в днях), уже выплаченные в текущей серии. */
  ladderPaid: number[];
}

export const EMPTY_RELAY: RelayLedger = { nuts: 0, credited: [], streak: 0, lastMetDate: null, ladderPaid: [] };

/** Шаги и норма дня: шаги — после шумоподавления, как везде, где итог дня. */
export interface RelayDay {
  date: string;
  steps: number | null;
  norm: number;
}

export const normMet = (day: Pick<RelayDay, 'steps' | 'norm'>): boolean => day.steps !== null && day.steps >= day.norm;

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Начисление по кэшу при открытии приложения. Идёт по прошедшим дням с выполненной нормой,
 * которые позже последнего засчитанного и ещё не начислены: +5 за день, серия и ступени лестницы.
 */
export function settleRelay(ledger: RelayLedger, days: readonly RelayDay[], today: string): RelayLedger {
  const credited = new Set(ledger.credited);
  const fresh = days
    .filter((d) => d.date < today && normMet(d) && !credited.has(d.date))
    .filter((d) => ledger.lastMetDate === null || d.date > ledger.lastMetDate)
    .map((d) => d.date)
    .sort();
  if (!fresh.length) return ledger;

  let { nuts, streak, lastMetDate } = ledger;
  let ladderPaid = [...ledger.ladderPaid];
  for (const date of fresh) {
    const continues = lastMetDate !== null && shiftDate(lastMetDate, 1) === date;
    if (!continues) {
      streak = 0;
      ladderPaid = [];
    }
    streak += 1;
    nuts += RELAY_DAY_REWARD;
    credited.add(date);
    const rung = STREAK_LADDER.find((r) => r.days === streak);
    if (rung && !ladderPaid.includes(rung.days)) {
      nuts += rung.nuts;
      ladderPaid.push(rung.days);
    }
    lastMetDate = date;
  }
  return { nuts, streak, lastMetDate, ladderPaid, credited: [...credited].sort().slice(-RELAY_CREDITED_KEEP) };
}

/** Что показывает карточка «Эстафета» за сегодня. */
export interface RelayView {
  steps: number;
  norm: number;
  /** Сколько шагов осталось до нормы; 0 — «Зелёный свет». */
  remaining: number;
  met: boolean;
  /** Серия (огонёк): дни подряд с нормой, закончившиеся вчера. Вчера пропущено — 0. */
  streak: number;
  nuts: number;
  /** Все ступени лестницы; `reached` — получена в текущей серии. */
  ladder: { days: number; nuts: number; reached: boolean }[];
}

export function relayView(ledger: RelayLedger, todayDay: Pick<RelayDay, 'steps' | 'norm'>, today: string): RelayView {
  const alive = ledger.lastMetDate !== null && ledger.lastMetDate >= shiftDate(today, -1);
  const steps = todayDay.steps ?? 0;
  const remaining = Math.max(0, todayDay.norm - steps);
  return {
    steps,
    norm: todayDay.norm,
    remaining,
    met: normMet(todayDay),
    streak: alive ? ledger.streak : 0,
    nuts: ledger.nuts,
    ladder: STREAK_LADDER.map((r) => ({ ...r, reached: alive && ledger.ladderPaid.includes(r.days) })),
  };
}
