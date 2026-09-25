import { describe, expect, it } from 'vitest';
import {
  EMPTY_RELAY,
  RELAY_DAY_REWARD,
  STREAK_LADDER,
  ladderPosition,
  nextRung,
  relayView,
  settleRelay,
  type RelayDay,
} from './relay';

const NORM = 8000;
const START = '2026-01-01';
const dateAt = (i: number) => new Date(Date.parse(`${START}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
/** i-й день от START: норма выполнена или нет. */
const day = (i: number, met: boolean): RelayDay => ({ date: dateAt(i), steps: met ? NORM + 500 : NORM - 1, norm: NORM });
/** n выполненных дней подряд, начиная с i-го. */
const run = (from: number, n: number) => Array.from({ length: n }, (_, k) => day(from + k, true));

/** Открываем приложение каждое утро: начисление по кэшу за прошедшие дни (дни идут с 0-го подряд). */
function daily(days: RelayDay[]) {
  let ledger = EMPTY_RELAY;
  const nutsByDay: number[] = [];
  for (let i = 0; i < days.length; i++) {
    const before = ledger.nuts;
    ledger = settleRelay(ledger, days.slice(0, i + 1), dateAt(i + 1));
    nutsByDay.push(ledger.nuts - before);
  }
  return { ledger, nutsByDay };
}

describe('СИНТЕТИЧЕСКИЕ: «Эстафета» — орехи за день', () => {
  it('константы: 5 орехов за день, лестница 7/30/60/120/365', () => {
    expect(RELAY_DAY_REWARD).toBe(5);
    expect(STREAK_LADDER.map((r) => [r.days, r.nuts])).toEqual([
      [7, 50],
      [30, 500],
      [60, 2000],
      [120, 5000],
      [365, 30000],
    ]);
  });

  it('выполненный вчера день — +5 при следующем открытии, повторное открытие не задваивает', () => {
    const days = [day(0, true)];
    const once = settleRelay(EMPTY_RELAY, days, dateAt(1));
    expect(once.nuts).toBe(5);
    expect(once.credited).toEqual([dateAt(0)]);
    expect(settleRelay(once, days, dateAt(1))).toBe(once);
    expect(settleRelay(once, days, dateAt(2)).nuts).toBe(5);
  });

  it('сегодняшний день не начисляется, пока не кончился; на карточке — «Зелёный свет»', () => {
    const today = day(0, true);
    const ledger = settleRelay(EMPTY_RELAY, [today], dateAt(0));
    expect(ledger.nuts).toBe(0);
    const view = relayView(ledger, today, dateAt(0));
    expect(view.met).toBe(true);
    expect(view.remaining).toBe(0);
  });

  it('остаток до нормы — норма минус шаги дня; нет шагов — вся норма', () => {
    expect(relayView(EMPTY_RELAY, { steps: 5200, norm: NORM }, dateAt(0))).toMatchObject({ remaining: 2800, met: false });
    expect(relayView(EMPTY_RELAY, { steps: null, norm: NORM }, dateAt(0))).toMatchObject({ remaining: NORM, met: false });
  });

  it('день без нормы не начисляется', () => {
    expect(settleRelay(EMPTY_RELAY, [day(0, false), { date: dateAt(1), steps: null, norm: NORM }], dateAt(2)).nuts).toBe(0);
  });
});

describe('СИНТЕТИЧЕСКИЕ: серия и лестница', () => {
  it('7 дней подряд: 7 × 5 + 50, огонёк 7, ступень 7 отмечена', () => {
    const days = run(0, 7);
    const ledger = settleRelay(EMPTY_RELAY, days, dateAt(7));
    expect(ledger.nuts).toBe(7 * 5 + 50);
    const view = relayView(ledger, day(7, false), dateAt(7));
    expect(view.streak).toBe(7);
    expect(view.ladder.map((r) => r.reached)).toEqual([true, false, false, false, false]);
  });

  it('не кумулятивно: на 30-й день +5 +500, а не +550', () => {
    const { ledger, nutsByDay } = daily(run(0, 30));
    expect(nutsByDay[6]).toBe(5 + 50);
    expect(nutsByDay[29]).toBe(5 + 500);
    expect(ledger.nuts).toBe(30 * 5 + 50 + 500);
    expect(ledger.streak).toBe(30);
  });

  it('вся лестница до 365 дней и дальше без бонусов', () => {
    const ledger = settleRelay(EMPTY_RELAY, run(0, 400), dateAt(400));
    expect(ledger.streak).toBe(400);
    expect(ledger.ladderPaid).toEqual([7, 30, 60, 120, 365]);
    expect(ledger.nuts).toBe(400 * 5 + 50 + 500 + 2000 + 5000 + 30000);
  });

  it('пропуск обнуляет серию, лестница тоже начинается заново', () => {
    const before = settleRelay(EMPTY_RELAY, run(0, 10), dateAt(10));
    expect(before.ladderPaid).toEqual([7]);
    // день 10 пропущен: на следующий день огонёк 0 и отметок на лестнице нет
    const missed = settleRelay(before, [...run(0, 10), day(10, false)], dateAt(11));
    const view = relayView(missed, day(11, false), dateAt(11));
    expect(view.streak).toBe(0);
    expect(view.ladder.every((r) => !r.reached)).toBe(true);
    // снова 7 дней подряд — ступень 7 выплачивается ещё раз
    const again = settleRelay(missed, [...run(0, 10), day(10, false), ...run(11, 7)], dateAt(18));
    expect(again.streak).toBe(7);
    expect(again.ladderPaid).toEqual([7]);
    expect(again.nuts - missed.nuts).toBe(7 * 5 + 50);
  });

  it('пока вчера выполнено, серия жива, даже если сегодня норма ещё не набрана', () => {
    const ledger = settleRelay(EMPTY_RELAY, run(0, 3), dateAt(3));
    expect(relayView(ledger, day(3, false), dateAt(3)).streak).toBe(3);
  });

  it('полные шаги вчера пришли позже — день засчитывается, серия не рвётся', () => {
    const early = [...run(0, 5), { date: dateAt(5), steps: NORM - 2000, norm: NORM }];
    const first = settleRelay(EMPTY_RELAY, early, dateAt(6));
    expect(first.streak).toBe(5);
    const late = [...run(0, 5), day(5, true)];
    const second = settleRelay(first, late, dateAt(6));
    expect(second.streak).toBe(6);
    expect(second.nuts).toBe(first.nuts + 5);
  });

  it('дорожка лестницы: ступени — целые позиции, между ними — доля пройденных дней', () => {
    expect(ladderPosition(0)).toBe(0);
    expect(ladderPosition(7)).toBe(1);
    expect(ladderPosition(3.5)).toBeCloseTo(0.5);
    // 7 → 30: пройдено 5 дней из 23
    expect(ladderPosition(12)).toBeCloseTo(1 + 5 / 23);
    expect(ladderPosition(365)).toBe(5);
    expect(ladderPosition(400)).toBe(5);
  });

  it('следующая награда: сколько дней осталось и сколько орехов', () => {
    expect(nextRung(0)).toEqual({ days: 7, left: 7, nuts: 50 });
    expect(nextRung(12)).toEqual({ days: 30, left: 18, nuts: 500 });
    expect(nextRung(365)).toBeNull();
  });
});
