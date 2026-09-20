import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../reference/sample_packets.json';
import { command, hexToBytes } from '../codec';
import { base64ToBytes, bytesToBase64 } from './base64';
import { handshake, runSync } from './sync';
import type { Transport } from './transport';

/** Подделка кольца: записывает команды и отвечает по сценарию (через 50 мс). */
function fakeRing(respond: (cmd: Uint8Array, sentBefore: Uint8Array[]) => Uint8Array[]) {
  const listeners = new Set<(d: Uint8Array) => void>();
  const sent: Uint8Array[] = [];
  const transport: Transport = {
    async send(data) {
      const replies = respond(data, [...sent]);
      sent.push(data);
      replies.forEach((r, i) => setTimeout(() => listeners.forEach((l) => l(r)), 50 + i * 10));
    },
    onPacket(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { transport, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('base64', () => {
  it('туда и обратно, в том числе с хвостами разной длины', () => {
    for (const n of [0, 1, 2, 3, 19, 20]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 5) & 255);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
    expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
  });
});

describe('СИНТЕТИЧЕСКИЕ (поддельное кольцо): рукопожатие', () => {
  it('сначала 0x01, потом 0x19', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x19 ? [command(0x19)] : []));
    const p = handshake(transport, Date.parse('2026-09-19T12:00:00Z'), 3 * 3600);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ autoMeasure: 'accepted' });
    expect(sent.map((c) => c[0])).toEqual([0x01, 0x19]);
  });
  it('нет ответа на 0x19 — одна повторная отправка', async () => {
    let n = 0;
    const { transport, sent } = fakeRing((c) => (c[0] === 0x19 && ++n === 2 ? [command(0x19)] : []));
    const p = handshake(transport, 0, 0);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ autoMeasure: 'accepted' });
    expect(sent.map((c) => c[0])).toEqual([0x01, 0x19, 0x19]);
  });
  it('отказ 0x99 и полная тишина различаются', async () => {
    const a = fakeRing((c) => (c[0] === 0x19 ? [command(0x99)] : []));
    const pa = handshake(a.transport, 0, 0);
    await vi.runAllTimersAsync();
    expect((await pa).autoMeasure).toBe('rejected');
    const b = fakeRing(() => []);
    const pb = handshake(b.transport, 0, 0);
    await vi.runAllTimersAsync();
    expect((await pb).autoMeasure).toBe('noreply');
  });
});

describe('выгрузка с реальными пакетами 0x40 и поддельным кольцом', () => {
  const byDay = new Map(fixtures.cases.map((c) => [c.day_offset, c.packets.map(hexToBytes)]));
  it('кислород больше не запрашивается', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x40 ? (byDay.get(c[1]) ?? []) : []));
    const p = runSync(transport, { days: 3 });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(sent[0][0]).toBe(0x13);
    expect(sent.some((c) => c[0] === 0x40)).toBe(false);
    expect(r.spo2).toEqual([]);
    expect(r.activity).toBeNull();
  });
  it('запросы идут по одному: архивы по дням, затем активность и заряд', async () => {
    const { transport, sent } = fakeRing(() => []);
    const p = runSync(transport, { days: 1 });
    await vi.runAllTimersAsync();
    await p;
    const codes = sent.map((c) => c[0]);
    expect(codes).toEqual([0x13, 0x10, 0x11, 0x16, 0x55, 0x03, 0x0b]);
  });
  it('пассивный заряд 0x0B и сводка 0x03 попадают в результат', async () => {
    const { transport } = fakeRing((c) =>
      c[0] === 0x03 ? [command(0x03, 0, 0, 0, 0, 100, 0, 0, 0)] : c[0] === 0x10 ? [command(0x0b, 64)] : [],
    );
    const p = runSync(transport, { days: 1 });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.battery).toBe(64);
    expect(r.activity?.steps).toBe(100);
  });
});
