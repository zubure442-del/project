import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command, formatWall, hexToBytes, parsePacket } from '../codec';
import { buildSleepSessions, nightForDate } from '../domain';
import { runSync } from './sync';
import type { Transport } from './transport';

/**
 * Настоящие байты кольца из сырого лога 20.09.2026 (сыройлог.pdf).
 * Главное, что они фиксируют: сон приходит в ответ на запрос ШАГОВ (0x10),
 * а на запрос сна (0x11) кольцо отвечает пустым подтверждением.
 */
const SLEEP_PACKETS = [
  '11 a0 ec ad 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
  '11 24 f0 ad 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
  '11 a8 f3 ad 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
  '11 2c f7 ad 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
  '11 b0 fa ad 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
  '11 34 fe ad 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
  '11 b8 01 ae 6a 63 63 63 63 63 63 63 63 63 63 63 63 63 63 63',
  '11 3c 05 ae 6a 63 63 63 63 63 63 63 63 63 63 63 63 63 63 63',
  '11 c0 08 ae 6a 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28',
];
const STEPS_PACKETS = [
  '10 a4 60 ae 6a 00 00 00 00 00 00 00 1c 00 00 20 82 13 00 00',
  '10 28 64 ae 6a 36 29 2f 22 00 00 1b 28 28 39 00 6a 42 00 00',
];
/** Ответ кольца на 0x11: день в байте 1, остальное нули. Данных не несёт. */
const SLEEP_ACK = '11 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';

describe('РЕАЛЬНЫЕ БАЙТЫ: пакеты сна 0x11', () => {
  it('минутные фазы разбираются: 0x28 — лёгкий сон, 0x63 — глубокий', () => {
    const light = parsePacket(hexToBytes(SLEEP_PACKETS[0]));
    expect(light.kind).toBe('sleep');
    if (light.kind === 'sleep') {
      expect(light.samples).toHaveLength(15);
      expect(light.samples.every((s) => s.value === 0x28)).toBe(true);
      expect(formatWall(light.samples[0].ts)).toBe('2026-09-19 02:00:00');
    }
    const deep = parsePacket(hexToBytes(SLEEP_PACKETS[6]));
    expect(deep.kind === 'sleep' && deep.samples.every((s) => s.value === 0x63)).toBe(true);
  });

  it('пакеты идут с шагом 15 минут и покрывают время без разрывов', () => {
    const samples = SLEEP_PACKETS.flatMap((hex) => {
      const p = parsePacket(hexToBytes(hex));
      return p.kind === 'sleep' ? p.samples : [];
    }).sort((a, b) => a.ts - b.ts);
    expect(samples).toHaveLength(135);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].ts - samples[i - 1].ts).toBe(60);
    }
  });

  it('ответ на сам запрос 0x11 — пустышка с меткой времени 1, данными не считается', () => {
    expect(parsePacket(hexToBytes(SLEEP_ACK)).kind).toBe('unknown');
  });
});

describe('РЕАЛЬНЫЕ БАЙТЫ: сон приходит в ответ на запрос шагов', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Кольцо: на 0x10 отдаёт сначала сон, потом шаги; на 0x11 — пустое подтверждение. */
  function fakeRing() {
    const listeners = new Set<(d: Uint8Array) => void>();
    const sent: Uint8Array[] = [];
    const reply = (hexes: string[]) =>
      hexes.forEach((hex, i) => setTimeout(() => listeners.forEach((l) => l(hexToBytes(hex))), 30 + i * 10));
    const transport: Transport = {
      async send(data) {
        sent.push(data);
        if (data[0] === 0x10 && data[1] === 1) reply([...SLEEP_PACKETS, ...STEPS_PACKETS]);
        else if (data[0] === 0x11) reply([SLEEP_ACK]);
      },
      onPacket(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    return { transport, sent };
  }

  it('сон попадает в выгрузку, хотя пришёл в чужом окне', async () => {
    const { transport, sent } = fakeRing();
    const p = runSync(transport, { days: 2 });
    await vi.runAllTimersAsync();
    const r = await p;

    expect(r.sleep).toHaveLength(135);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.packetCounts.sleep).toBe(9);
    // запрос 0x11 всё равно отправляем: так описано в PROTOCOL.md
    expect(sent.some((c) => c[0] === 0x11)).toBe(true);
  });

  it('из этих минут собирается ночь с глубокой и лёгкой фазой', async () => {
    const { transport } = fakeRing();
    // кольцо в этом логе отвечает на день −1, поэтому запрашиваем два дня
    const p = runSync(transport, { days: 2 });
    await vi.runAllTimersAsync();
    const r = await p;

    const sessions = buildSleepSessions(r.sleep);
    expect(sessions).toHaveLength(1);
    const { night } = nightForDate(sessions, '2026-09-19');
    expect(night).not.toBeNull();
    expect(night?.deepMin).toBe(30);
    expect(night?.lightMin).toBe(105);
  });

  it('пустое подтверждение 0x11 не создаёт ложных минут сна', async () => {
    const listeners = new Set<(d: Uint8Array) => void>();
    const transport: Transport = {
      async send() {
        setTimeout(() => listeners.forEach((l) => l(hexToBytes(SLEEP_ACK))), 30);
      },
      onPacket(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const p = runSync(transport, { days: 1 });
    await vi.runAllTimersAsync();
    expect((await p).sleep).toEqual([]);
  });
});

describe('РЕАЛЬНЫЕ БАЙТЫ: сводка 0x55', () => {
  /** Три одинаковые записи: один замер, продублированный на все слоты. */
  const DUPLICATED = '55 8c 2c af 6a 71 47 0b 37 50 71 47 0b 37 50 71 47 0b 37 50';
  const NEXT = '55 94 33 af 6a 6e 48 05 3e 52 6e 48 05 3e 52 6e 48 05 3e 52';
  /** Служебный пакет конца суток: вся запись нулевая. */
  const DAY_END = '55 fc cc ad 6a 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';

  it('одинаковые записи схлопываются в одну точку по времени первой', () => {
    const p = parsePacket(hexToBytes(DUPLICATED));
    expect(p.kind).toBe('summary');
    if (p.kind !== 'summary') return;
    expect(p.records).toHaveLength(1);
    expect(formatWall(p.records[0].ts)).toBe('2026-09-20 00:45:00');
    expect(p.records[0]).toMatchObject({ systolic: 113, diastolic: 71, stress: 11, glucose: 5.5, hrv: 80 });
  });

  it('соседние пакеты дают шаг 30 минут — период автозамера', () => {
    const a = parsePacket(hexToBytes(DUPLICATED));
    const b = parsePacket(hexToBytes(NEXT));
    if (a.kind !== 'summary' || b.kind !== 'summary') throw new Error('не сводка');
    expect(b.records[0].ts - a.records[0].ts).toBe(1800);
  });

  it('нулевая запись замером не считается', () => {
    const p = parsePacket(hexToBytes(DAY_END));
    expect(p.kind === 'summary' && p.records).toEqual([]);
  });

  it('СИНТЕТИЧЕСКИЙ: разные записи остаются раздельными, шаг 15 минут', () => {
    const p = parsePacket(
      hexToBytes('55 8c 2c af 6a 71 47 0b 37 50 6e 48 05 3e 52 71 47 0b 37 50'),
    );
    if (p.kind !== 'summary') throw new Error('не сводка');
    expect(p.records).toHaveLength(3);
    expect(p.records[1].ts - p.records[0].ts).toBe(900);
    expect(p.records[1].stress).toBe(5);
  });
});

describe('РЕАЛЬНЫЕ БАЙТЫ: заряд 0x0B', () => {
  it('кольцо отвечает процентом на запрос', () => {
    expect(parsePacket(hexToBytes('0b 2d 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'))).toEqual({
      kind: 'battery',
      percent: 45,
    });
    expect(Array.from(command(0x0b).slice(0, 2))).toEqual([0x0b, 0]);
  });
});
