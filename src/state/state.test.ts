import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, type VueloState } from '../storage';
import { CACHE_FRESH_MS, isFresh } from './day';

const state = (over: Partial<VueloState>): VueloState => ({ ...EMPTY_STATE, ...over });
const NOW = Date.parse('2026-09-21T12:00:00Z');

describe('правило десяти минут', () => {
  it('свежие данные к кольцу не гонят', () => {
    expect(isFresh(state({ lastSyncAt: NOW - 60_000 }), NOW)).toBe(true);
    expect(isFresh(state({ lastSyncAt: NOW - (CACHE_FRESH_MS - 1000) }), NOW)).toBe(true);
  });

  it('старше десяти минут — пора обновляться', () => {
    expect(isFresh(state({ lastSyncAt: NOW - CACHE_FRESH_MS - 1 }), NOW)).toBe(false);
  });

  it('неудачная синхронизация свежей не считается: частичные данные не маскируем', () => {
    expect(isFresh(state({ lastSyncAt: NOW - 1000, syncFailed: true }), NOW)).toBe(false);
  });

  it('пустой кэш всегда несвежий', () => {
    expect(isFresh(EMPTY_STATE, NOW)).toBe(false);
  });

  it('порог именно десять минут, а не пять', () => {
    expect(CACHE_FRESH_MS).toBe(10 * 60 * 1000);
  });
});
