/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateKey } from '../codec';
import { dropGlucoseSpikes } from '../domain';
import { applySyncResult, finalFrom, planDays } from '../state/sync-plan';
import { EMPTY_STATE } from '../storage';
import { logRing } from './log-replay';
import { resetLightThrottle, runSync, type SyncResult } from './sync';

/**
 * РЕАЛЬНЫЙ ЛОГ 25.09.2026 (reference/logs/ring-log-2026-09-25.txt): две выгрузки при заполненном кэше,
 * запрошены сегодня и вчера.
 * 10:55 — человек шёл: кольцо само слало 03/13, потоки 0x55 и 0x40 замерли после 1–5 пакетов,
 *         их хвосты пришли в окнах следующих запросов и даже в следующей выгрузке.
 * 11:39 — хвост 0x40 за 24.09 с маркером 23:45 пришёл в окне 0x55 за сегодня.
 */
const LOG = readFileSync('reference/logs/ring-log-2026-09-25.txt', 'utf8');
const TODAY = '2026-09-25';

/** Кусок лога между двумя моментами «ЧЧ:ММ:СС» — одна выгрузка. */
function slice(from: string, to: string): string {
  return LOG.split('\n')
    .filter((line) => {
      const time = line.slice(0, 8);
      return /^\d\d:\d\d:\d\d$/.test(time) && time >= from && time < to;
    })
    .join('\n');
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLightThrottle();
});
afterEach(() => vi.useRealTimers());

async function replay(from: string, to: string): Promise<{ result: SyncResult; seconds: number; notes: string[] }> {
  const { transport } = logRing(slice(from, to));
  const notes: string[] = [];
  const started = Date.now();
  let finishedAt = started;
  const run = runSync(transport, { days: [0, 1], today: TODAY, onNote: (n) => notes.push(n) });
  void run.then(() => {
    finishedAt = Date.now();
  });
  await vi.runAllTimersAsync();
  const result = await run;
  return { result, seconds: (finishedAt - started) / 1000, notes };
}

const FIRST = () => replay('10:55:13', '10:56:00');
const SECOND = () => replay('11:39:06', '11:40:00');

describe('РЕАЛЬНЫЙ ЛОГ 25.09 11:39: маркер чужого потока не закрывает запрос', () => {
  it('маркер 0x40 за 24.09 в окне 0x55 за сегодня не делает сегодня завершённым', async () => {
    const { result, notes } = await SECOND();
    // Поток 0x55 за сегодня своего маркера 23:45 не прислал: день 0 не завершён, вчера — завершён.
    expect(result.completeDays).toEqual([1]);
    expect(notes.find((n) => n.startsWith('день 0'))).toContain('0x55 пауза');
  });

  it('хвосты чужих потоков сохраняются по своему коду и дате', async () => {
    const { result } = await SECOND();
    const spo2Dates = new Set(result.spo2.map((s) => dateKey(s.ts)));
    expect(spo2Dates).toEqual(new Set(['2026-09-24', TODAY]));
    // Замеры 0x55 за сегодня 07:15–09:45 пришли уже в окнах других запросов.
    const todaySummary = result.summary.filter((r) => dateKey(r.ts) === TODAY);
    expect(todaySummary.length).toBeGreaterThanOrEqual(19);
  });
});

describe('РЕАЛЬНЫЙ ЛОГ 25.09 10:55: замерший поток 0x55/0x40 не держит выгрузку 5 секунд', () => {
  it('выгрузка сегодня и вчера — меньше 36 с вместо 46', async () => {
    const { seconds } = await FIRST();
    expect(seconds).toBeLessThan(36);
  });

  it('дни с замершими потоками не отмечены завершёнными: в следующий раз их запросят снова', async () => {
    const { result } = await FIRST();
    expect(result.completeDays).toEqual([]);
  });
});

describe('РЕАЛЬНЫЙ ЛОГ 25.09: вчера финальный, как только пришёл сон этой ночи', () => {
  it('после выгрузки 11:39 (сон за 25.09 уже в кэше) до полудня запрашивается только сегодня', async () => {
    // Кэш как в логе: 19–23.09 уже финальные («из кэша: 2, 3, 4, 5, 6»).
    const cached = Object.fromEntries(
      ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'].map((d) => [d, finalFrom(d)]),
    );
    const first = await FIRST();
    const afterFirst = applySyncResult(
      { ...EMPTY_STATE, started: true, syncedAt: cached },
      first.result,
      null,
      new Date(2026, 8, 25, 10, 56),
    );
    // В 10:55 вчера не выгружен целиком — перед полуднем он ещё в плане.
    expect(planDays(afterFirst.syncedAt, new Date(2026, 8, 25, 11, 39)).days).toEqual([0, 1]);

    const second = await SECOND();
    const afterSecond = applySyncResult(afterFirst, second.result, null, new Date(2026, 8, 25, 11, 40));
    expect(afterSecond.raw[TODAY].sleep.length).toBeGreaterThan(0);
    // 11:50 — ещё до полудня, но ночь уже пришла, и вчера выгружен целиком после неё.
    expect(planDays(afterSecond.syncedAt, new Date(2026, 8, 25, 11, 50)).days).toEqual([0]);
  });
});

describe('РЕАЛЬНЫЙ ЛОГ 25.09: выбросы глюкозы', () => {
  it('ночные скачки 5.1 → 6.9 → 5.4 и 5.6 → 6.6 → 5.1 убраны, завтрак 6.7 → 7.0 → 7.4 → 6.7 на месте', async () => {
    const { result } = await SECOND();
    const after = dropGlucoseSpikes(result.summary);
    const at = (r: { ts: number }) => new Date(r.ts * 1000).toISOString().slice(5, 16);
    const dropped = result.summary.filter((r, i) => r.glucose !== null && after[i].glucose === null).map(at);
    // 24.09 18:15 — 5.1 → 6.7, а следующий замер только в 22:15 (через 4 ч): подтвердить нечем,
    // с 26.09 такой скачок не показываем (владелец: «проверять следующей точкой, нет — пропустить»).
    expect(dropped).toEqual(['09-24T16:45', '09-24T18:15', '09-25T00:45', '09-25T03:15']);
    const keptAt = new Set(after.filter((r) => r.glucose !== null).map(at));
    for (const meal of ['09-25T07:45', '09-25T08:45', '09-25T09:15', '09-25T09:45', '09-24T13:15']) expect(keptAt).toContain(meal);
  });
});
