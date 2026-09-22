import { describe, expect, it } from 'vitest';
import { emptySyncResult } from '../ble/sync';
import { RELAY_DAY_REWARD, formatCount, pluralRu } from '../domain';
import { generateDemoRaw } from '../demo/generate';
import { EMPTY_STATE, toSyncResult, type Profile } from '../storage';
import { demoState } from './demo';
import { relayDay, relayFor, settleRelayState } from './relay';
import { applySyncResult } from './sync-plan';

const NOON = new Date(2026, 8, 22, 13, 10);
const TODAY = '2026-09-22';
const PROFILE: Profile = { name: null, sex: 'male', heightCm: 180, weightKg: 75, birthYear: 1990, goal: 'keep' };

describe('СИНТЕТИЧЕСКИЕ: «Эстафета» в состоянии приложения', () => {
  const base = { ...EMPTY_STATE, started: true, profile: PROFILE };
  const synced = applySyncResult(base, toSyncResult(generateDemoRaw(11, NOON)), null, NOON);
  const metPast = synced.days.filter((d) => d.date < TODAY && relayDay(d.date, d).steps! >= relayDay(d.date, d).norm);

  it('после выгрузки начислено по 5 орехов за каждый прошедший день с нормой — и только за них', () => {
    expect(synced.relay.credited).toEqual(metPast.map((d) => d.date));
    expect(synced.relay.credited).not.toContain(TODAY);
    expect(synced.relay.nuts).toBeGreaterThanOrEqual(metPast.length * RELAY_DAY_REWARD);
  });

  it('повторная выгрузка и повторное открытие не задваивают', () => {
    const again = applySyncResult(synced, emptySyncResult(), null, new Date(2026, 8, 22, 15));
    expect(again.relay).toEqual(synced.relay);
    expect(settleRelayState(again, new Date(2026, 8, 22, 16))).toBe(again);
  });

  it('карточка за сегодня: норма и шаги того же дня', () => {
    const day = synced.days.find((d) => d.date === TODAY)!;
    const view = relayFor(synced, NOON);
    expect(view.norm).toBe(day.stepNorm?.value);
    expect(view.steps).toBe(day.steps);
    expect(view.remaining).toBe(Math.max(0, view.norm - view.steps));
  });

  it('демо не трогает настоящий баланс: у него своя «Эстафета»', () => {
    const real = { ...base, relay: { ...base.relay, nuts: 777 } };
    const demo = demoState(real, 5, NOON);
    expect(real.relay.nuts).toBe(777);
    expect(demo.relay.nuts).not.toBe(777);
  });
});

describe('тексты с числами', () => {
  it('склонение: шаг, шага, шагов', () => {
    const forms = ['шаг', 'шага', 'шагов'] as const;
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 100, 101, 111].map((n) => pluralRu(n, forms))).toEqual([
      'шаг', 'шага', 'шага', 'шагов', 'шагов', 'шагов', 'шагов', 'шаг', 'шага', 'шагов', 'шагов', 'шаг', 'шагов',
    ]);
  });

  it('разряды через неразрывный пробел', () => {
    expect(formatCount(30000)).toBe('30 000');
    expect(formatCount(950)).toBe('950');
    expect(formatCount(1234567)).toBe('1 234 567');
  });
});
