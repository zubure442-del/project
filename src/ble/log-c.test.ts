/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { weekDays } from '../state/day';
import { applySyncResult, planDays } from '../state/sync-plan';
import { EMPTY_STATE } from '../storage';
import { logRing } from './log-replay';
import { resetLightThrottle, runSync, type SyncResult } from './sync';

/**
 * РЕАЛЬНЫЙ ЛОГ 21.09.2026 13:10 (reference/logs/ring-log-2026-09-21-c.txt):
 * полная выгрузка недели, кольцо отвечает с настоящими задержками.
 * 15.09 (день 6) пустой: только маркеры 23:45 и `16 ff` — кольца тогда ещё не было.
 */
const LOG = readFileSync('reference/logs/ring-log-2026-09-21-c.txt', 'utf8');
const WEEK = [0, 1, 2, 3, 4, 5, 6];
/** Время телефона в конце выгрузки: 21.09 13:11 по местному времени. */
const SYNC_END = new Date(2026, 8, 21, 13, 11, 47);

beforeEach(() => {
  vi.useFakeTimers();
  resetLightThrottle();
});
afterEach(() => vi.useRealTimers());

async function replayWeek(): Promise<{ result: SyncResult; seconds: number; sent: string[] }> {
  const { transport, sent } = logRing(LOG);
  const started = Date.now();
  const run = runSync(transport, { days: WEEK });
  await vi.runAllTimersAsync();
  const result = await run;
  return { result, seconds: (Date.now() - started) / 1000, sent };
}

describe('РЕАЛЬНЫЙ ЛОГ c: конец потока по маркеру', () => {
  it('неделя с пустыми днями 5–6 считается полной: все потоки закрыты маркером', async () => {
    const { result } = await replayWeek();
    expect(result.completeDays).toEqual(WEEK);
    expect(result.error).toBeNull();
    expect(result.capped).toBe(false);
  });

  it('у дня 4 окно шагов кончается пакетом СНА за 23:45 — это тоже маркер', async () => {
    const { result } = await replayWeek();
    expect(result.completeDays).toContain(4);
  });

  it('неделя грузится около 30 с, а не 67: после маркера сразу следующий запрос', async () => {
    const { seconds, sent } = await replayWeek();
    // Сам ответ кольца занимает ~25 с; раньше ещё по 1.3 с ждали после каждого из 28 маркеров.
    expect(seconds).toBeLessThan(36);
    // 0x11 не запрашиваем, по четыре запроса на день и два разовых в конце.
    expect(sent.filter((c) => c.startsWith('11'))).toEqual([]);
    expect(sent.slice(-2)).toEqual(['03 00', '0b 00']);
  });

  it('заряд приходит в ответ на 0x0B в конце выгрузки', async () => {
    const { result } = await replayWeek();
    expect(result.battery).toBe(24);
  });
});

describe('РЕАЛЬНЫЙ ЛОГ c: сон в кэше и на экранах', () => {
  it('ночи 17–18, 19, 20 и 21 сентября попадают в кэш и в неделю', async () => {
    const { result } = await replayWeek();
    const state = applySyncResult({ ...EMPTY_STATE, started: true }, result, null, SYNC_END);
    for (const date of ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21']) {
      expect(state.raw[date].sleep.length, date).toBeGreaterThan(0);
      expect(state.days.find((d) => d.date === date)?.sleep, date).not.toBeNull();
    }
    // Ночь 17→18 начинается вечером 17-го: минуты до полуночи отрицательные.
    expect(state.raw['2026-09-18'].sleep[0][0]).toBeLessThan(0);
    const week = weekDays(state.days, SYNC_END);
    expect(week.filter((w) => w.day?.sleep).map((w) => w.date)).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ]);
  });

  it('пустые 15.09 и 16.09 выгружены целиком: через 10 минут запрашивается только сегодня', async () => {
    const { result } = await replayWeek();
    const state = applySyncResult({ ...EMPTY_STATE, started: true }, result, null, SYNC_END);
    expect(Object.keys(state.syncedAt)).toEqual([
      '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21',
    ]);
    // 13:18 — тот самый повторный запуск: раньше он снова тянул все 7 дней.
    expect(planDays(state.syncedAt, new Date(2026, 8, 21, 13, 18)).days).toEqual([0]);
    expect(state.syncFailed).toBe(false);
    expect(state.lastSyncAt).toBe(SYNC_END.getTime());
  });

  it('перезаход после полудня: только сегодня, около 10 с', async () => {
    const { transport } = logRing(LOG);
    const started = Date.now();
    const run = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    const result = await run;
    const seconds = (Date.now() - started) / 1000;
    expect(result.completeDays).toEqual([0]);
    // Сегодня к 13:00 — самый тяжёлый день (пульс за полдня); плюс ~2–4 с на рукопожатие.
    expect(seconds).toBeLessThan(12);
  });

  it('«Организм» v2: у 16.09 замеры только с 20:15 — меньше 4 часов, оценки и итога нет', async () => {
    const { result } = await replayWeek();
    const state = applySyncResult({ ...EMPTY_STATE, started: true }, result, null, SYNC_END);
    const byDate = (date: string) => state.days.find((d) => d.date === date);
    expect(byDate('2026-09-16')?.scores.state).toBeNull();
    expect(byDate('2026-09-16')?.total).toBeNull();
    expect(byDate('2026-09-21')?.scores.state).not.toBeNull();
    expect(byDate('2026-09-21')?.total).not.toBeNull();
    // Сегодня полный — совет записан за сегодня, в дневном режиме.
    expect(state.reports.map((r) => [r.date, r.mode])).toEqual([['2026-09-21', 'day']]);
  });
});
