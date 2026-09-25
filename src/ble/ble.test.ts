import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../reference/sample_packets.json';
import { command, hexToBytes } from '../codec';
import { base64ToBytes, bytesToBase64 } from './base64';
import { FIRST_PACKET_MS, handshake, resetLightThrottle, runSync } from './sync';
import type { Transport } from './transport';

/** Подделка кольца: записывает команды и отвечает по сценарию (через 50 мс). */
function fakeRing(respond: (cmd: Uint8Array, sentBefore: Uint8Array[]) => Uint8Array[], delayMs = 50) {
  const listeners = new Set<(d: Uint8Array) => void>();
  const sent: Uint8Array[] = [];
  const sentAt: number[] = [];
  const transport: Transport = {
    async send(data) {
      const replies = respond(data, [...sent]);
      sent.push(data);
      sentAt.push(Date.now());
      replies.forEach((r, i) => setTimeout(() => listeners.forEach((l) => l(r)), delayMs + i * 10));
    },
    onPacket(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { transport, sent, sentAt };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLightThrottle();
});
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
  it('профиль уходит после 0x01 и 0x19', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x19 ? [command(0x19)] : []));
    const p = handshake(transport, { age: 30, heightCm: 180, weightKg: 80, male: true }, 30, 0, 0);
    await vi.runAllTimersAsync();
    await p;
    expect(sent.map((c) => c[0])).toEqual([0x01, 0x19, 0x02]);
    expect(Array.from(sent[2].slice(0, 5))).toEqual([0x02, 0x9e, 0xb4, 0x50, 0x00]);
  });

  it('пустой профиль кольцу не отправляем', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x19 ? [command(0x19)] : []));
    const p = handshake(transport, null, 30, 0, 0);
    await vi.runAllTimersAsync();
    await p;
    expect(sent.some((c) => c[0] === 0x02)).toBe(false);
  });

  it('сначала 0x01, потом 0x19', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x19 ? [command(0x19)] : []));
    const p = handshake(transport, null, 30, Date.parse('2026-09-19T12:00:00Z'), 3 * 3600);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ autoMeasure: 'accepted' });
    expect(sent.map((c) => c[0])).toEqual([0x01, 0x19]);
  });
  it('нет ответа на 0x19 — одна повторная отправка', async () => {
    let n = 0;
    const { transport, sent } = fakeRing((c) => (c[0] === 0x19 && ++n === 2 ? [command(0x19)] : []));
    const p = handshake(transport, null, 30, 0, 0);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ autoMeasure: 'accepted' });
    expect(sent.map((c) => c[0])).toEqual([0x01, 0x19, 0x19]);
  });
  it('отказ 0x99 и полная тишина различаются', async () => {
    const a = fakeRing((c) => (c[0] === 0x19 ? [command(0x99)] : []));
    const pa = handshake(a.transport, null, 30, 0, 0);
    await vi.runAllTimersAsync();
    expect((await pa).autoMeasure).toBe('rejected');
    const b = fakeRing(() => []);
    const pb = handshake(b.transport, null, 30, 0, 0);
    await vi.runAllTimersAsync();
    expect((await pb).autoMeasure).toBe('noreply');
  });
});

describe('выгрузка с реальными пакетами 0x40 и поддельным кольцом', () => {
  const byDay = new Map(fixtures.cases.map((c) => [c.day_offset, c.packets.map(hexToBytes)]));
  it('кислород снова запрашивается и разбирается', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x40 ? (byDay.get(c[1]) ?? []) : []));
    const p = runSync(transport, { days: [0, 1, 2] });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(sent[0][0]).toBe(0x13);
    expect(sent.some((c) => c[0] === 0x40)).toBe(true);
    expect(r.spo2).toHaveLength(16);
    expect(r.activity).toBeNull();
  });
  it('на тишину запрос повторяется один раз, но выгрузка идёт дальше', async () => {
    const { transport, sent } = fakeRing(() => []);
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    await p;
    // 0x11 больше не шлём; каждый архивный запрос ушёл дважды, разовые 0x03 и 0x0B — по разу
    expect(sent.map((c) => c[0])).toEqual([0x13, 0x10, 0x10, 0x16, 0x16, 0x55, 0x55, 0x40, 0x40, 0x03, 0x0b]);
  });

  it('в окне первого пакета второй запрос не уходит', async () => {
    // Кольцо молчит: повтор допустим, но не раньше FIRST_PACKET_MS.
    const { transport, sent, sentAt } = fakeRing(() => []);
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    await p;
    const stepsAt = sent.map((c, i) => ({ code: c[0], at: sentAt[i] })).filter((x) => x.code === 0x10);
    expect(stepsAt).toHaveLength(2);
    expect(stepsAt[1].at - stepsAt[0].at).toBeGreaterThanOrEqual(FIRST_PACKET_MS);
  });

  it('кольцо ответило поздно — повтора нет', async () => {
    // ответ приходит через 7 секунд, как в логе после «06 02»
    const { transport, sent } = fakeRing(
      (c) => (c[0] === 0x10 ? [hexToBytes('10 9c 3a af 6a 00 00 00 15 2b 00 00 00 00 00 33 07 00 00 00')] : []),
      7000,
    );
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(sent.filter((c) => c[0] === 0x10)).toHaveLength(1);
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it('явный конец потока (16 ff) повтора не вызывает', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x16 ? [command(0x16, 0xff)] : []));
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    await p;
    expect(sent.filter((c) => c[0] === 0x16)).toHaveLength(1);
  });

  it('живой пульс 0x14 попадает в замеры', async () => {
    const { transport } = fakeRing((c) =>
      c[0] === 0x10 ? [hexToBytes('14 26 8c b0 6a 47 00 00 00 00 00 00 00 00 00 00 00 00 00 00')] : [],
    );
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.heart.map((h) => h.value)).toEqual([71]);
  });

  it('на ответ «занято» запрос не повторяем, а ждём', async () => {
    const { transport, sent } = fakeRing((c) => (c[0] === 0x10 ? [command(0x06, 0x02)] : []));
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    await p;
    expect(sent.filter((c) => c[0] === 0x10)).toHaveLength(1);
  });

  it('маркер 23:45 закрывает поток быстрее, чем тайм-аут', async () => {
    const withMarker = fakeRing((c) => (c[0] === 0x10 ? [command(0x10, 0x7c, 0xc1, 0xb1, 0x6a)] : []));
    const silent = fakeRing(() => []);
    const t0 = Date.now();
    const withMarkerRun = runSync(withMarker.transport, { days: [0], today: '2026-09-21' });
    await vi.runAllTimersAsync();
    await withMarkerRun;
    const fast = Date.now() - t0;

    const t1 = Date.now();
    const silentRun = runSync(silent.transport, { days: [0] });
    await vi.runAllTimersAsync();
    await silentRun;
    const slow = Date.now() - t1;

    expect(fast).toBeLessThan(slow);
    expect(withMarker.sent.filter((c) => c[0] === 0x10)).toHaveLength(1);
  });

  describe('маркер 23:45 закрывает только свой поток и свой день', () => {
    const TODAY = '2026-09-25';
    /** Метки 23:45 за 25.09 (7c 07 b7 6a) и за 24.09 (fc b5 b5 6a), как в логе 25.09. */
    const end = (code: string, day: 'today' | 'yesterday') =>
      hexToBytes(`${code} ${day === 'today' ? '7c 07 b7 6a' : 'fc b5 b5 6a'} 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00`);
    const TODAY_SUMMARY = hexToBytes('55 04 bd b5 6a 6e 46 05 33 51 6e 46 05 33 51 6e 46 05 33 51');

    it('маркер 0x55 за вчера не закрывает 0x55 за сегодня', async () => {
      const notes: string[] = [];
      const { transport } = fakeRing((c) =>
        c[0] === 0x10 ? [end('10', 'today')]
        : c[0] === 0x16 ? [command(0x16, 0xff)]
        : c[0] === 0x55 ? [TODAY_SUMMARY, end('55', 'yesterday')]
        : c[0] === 0x40 ? [end('40', 'today')]
        : [],
      );
      const p = runSync(transport, { days: [0], today: TODAY, onNote: (n) => notes.push(n) });
      await vi.runAllTimersAsync();
      const r = await p;
      expect(r.completeDays).toEqual([]);
      expect(notes[0]).toContain('0x55 пауза');
    });

    it('свой маркер, пришедший в окне следующего запроса, засчитывается дню', async () => {
      const notes: string[] = [];
      const { transport } = fakeRing((c) =>
        c[0] === 0x10 ? [end('10', 'today')]
        : c[0] === 0x16 ? [command(0x16, 0xff)]
        : c[0] === 0x55 ? [TODAY_SUMMARY]
        : c[0] === 0x40 ? [end('55', 'today'), end('40', 'today')]
        : [],
      );
      const p = runSync(transport, { days: [0], today: TODAY, onNote: (n) => notes.push(n) });
      await vi.runAllTimersAsync();
      const r = await p;
      expect(r.completeDays).toEqual([0]);
      expect(notes[0]).toContain('0x55 маркер позже');
    });
  });

  it('пока кольцо отвечает, запрос не повторяется и не считается сбоем', async () => {
    const { transport, sent } = fakeRing((c) =>
      c[0] === 0x10 ? [command(0x10, 0x00, 0x60, 0xae, 0x6a, 5, 5, 5)] : [],
    );
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(sent.filter((c) => c[0] === 0x10)).toHaveLength(1);
    expect(r.steps.length).toBeGreaterThan(0);
  });
  it('пассивный заряд 0x0B и сводка 0x03 попадают в результат', async () => {
    const { transport } = fakeRing((c) =>
      c[0] === 0x03 ? [command(0x03, 0, 0, 0, 0, 100, 0, 0, 0)] : c[0] === 0x10 ? [command(0x0b, 64)] : [],
    );
    const p = runSync(transport, { days: [0] });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.battery).toBe(64);
    expect(r.activity?.steps).toBe(100);
  });
});
