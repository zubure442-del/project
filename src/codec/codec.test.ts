import { describe, expect, it } from 'vitest';
import fixtures from '../../reference/sample_packets.json';
import {
  FUNCTION_BIT,
  archiveCommand,
  autoMeasureCommand,
  command,
  formatWall,
  hasFunction,
  heartFromSamples,
  hexToBytes,
  parsePacket,
  setTimeCommand,
} from './index';

/** Ring-метка из строки «настенного» времени. */
const ring = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') / 1000;
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
/** Синтетический пакет: код + байты, добитый нулями до 20. */
const pkt = (...b: number[]) => command(...b);

describe('реальные фикстуры 0x40 (sample_packets.json)', () => {
  for (const c of fixtures.cases) {
    it(`день -${c.day_offset}: ${c.expected_count} замеров`, () => {
      const points = c.packets.flatMap((hex) => {
        const p = parsePacket(hexToBytes(hex));
        expect(p.kind).toBe('spo2');
        return p.kind === 'spo2' ? p.samples : [];
      });
      expect(points.map((s) => ({ time: formatWall(s.ts), spo2: s.value }))).toEqual(c.expected);
      expect(points).toHaveLength(c.expected_count);
    });
  }

  it('последний пакет каждого дня — маркер конца суток 23:45', () => {
    for (const c of fixtures.cases) {
      const last = parsePacket(hexToBytes(c.packets[c.packets.length - 1]));
      expect(last.kind === 'spo2' && last.isDayEnd).toBe(true);
    }
  });
});

describe('СИНТЕТИЧЕСКИЕ: 0x40', () => {
  const t = ring('2026-09-18 08:00:00');
  it('разные значения в слоте — отдельные минутные точки', () => {
    const p = parsePacket(pkt(0x40, ...u32(t), 98, 98, 97, ...Array(12).fill(0)));
    expect(p.kind === 'spo2' && p.samples.map((s) => [s.ts - t, s.value])).toEqual([
      [0, 98],
      [60, 98],
      [120, 97],
    ]);
  });
  it('нули и 255 — не данные, 101 вне диапазона', () => {
    const p = parsePacket(pkt(0x40, ...u32(t), 0, 255, 101, ...Array(12).fill(0)));
    expect(p.kind === 'spo2' && p.samples).toEqual([]);
  });
  it('один валидный байт среди нулей — одна точка с его минутой', () => {
    const p = parsePacket(pkt(0x40, ...u32(t), 0, 0, 96, ...Array(12).fill(0)));
    expect(p.kind === 'spo2' && p.samples).toEqual([{ ts: t + 120, value: 96 }]);
  });
  it('плохая метка времени — не пакет данных', () => {
    expect(parsePacket(pkt(0x40, 1, 0, 0, 0, 99)).kind).toBe('unknown');
  });
});

describe('СИНТЕТИЧЕСКИЕ: пульс 0x16', () => {
  const t = ring('2026-09-18 10:00:00');
  it('медиана подзамеров, а не среднее; мусор вне 30–220 отбрасывается', () => {
    const p = parsePacket(pkt(0x16, 0xa0, ...u32(t), 0, 0, 78, 78, 30, 78, 150, 78, 0, 255, 70, 72, 74, 76));
    expect(p.kind).toBe('heart');
    if (p.kind === 'heart' && p.phase === 'data') {
      // 78,78,30,78,150,78 -> медиана 78 (среднее было бы 82)
      expect(p.samples.map((s) => [s.ts - t, s.value])).toEqual([
        [0, 78],
        [60, 73],
      ]);
    }
  });
  it('округление как в Python: половинки к чётному', () => {
    expect(heartFromSamples([77, 78])).toBe(78);
    expect(heartFromSamples([78, 79])).toBe(78);
  });
  it('минута без годных подзамеров пропускается', () => {
    const p = parsePacket(pkt(0x16, 0xa0, ...u32(t), 0, 0, 0, 0, 0, 0, 0, 0, 80, 80, 80, 80, 80, 80));
    expect(p.kind === 'heart' && p.phase === 'data' && p.samples).toEqual([
      { ts: t + 60, value: 80, raw: [80, 80, 80, 80, 80, 80] },
    ]);
  });
  it('подкоманды начала и конца', () => {
    expect(parsePacket(pkt(0x16, 0xf0))).toEqual({ kind: 'heart', phase: 'start' });
    expect(parsePacket(pkt(0x16, 0xff))).toEqual({ kind: 'heart', phase: 'end' });
  });
});

describe('СИНТЕТИЧЕСКИЕ: шаги 0x10 и сон 0x11', () => {
  const t = ring('2026-09-18 07:00:00');
  it('255 — нет данных, 0 — настоящий ноль', () => {
    const p = parsePacket(pkt(0x10, ...u32(t), 0, 12, 255, 30));
    expect(p.kind === 'steps' && p.samples.slice(0, 3)).toEqual([
      { ts: t, value: 0 },
      { ts: t + 60, value: 12 },
      { ts: t + 180, value: 30 },
    ]);
  });
  it('сон: минутные состояния, 255 пропускаются', () => {
    const p = parsePacket(pkt(0x11, ...u32(t), 85, 40, 0, 255, 90));
    expect(p.kind === 'sleep' && p.samples.slice(0, 4).map((s) => s.value)).toEqual([85, 40, 0, 90]);
  });
});

describe('СИНТЕТИЧЕСКИЕ: сводка 0x55', () => {
  const t = ring('2026-09-18 12:00:00');
  it('три записи по 5 байт, шаг 15 минут; третье поле — стресс', () => {
    const p = parsePacket(
      pkt(0x55, ...u32(t), 120, 80, 35, 52, 60, /**/ 255, 255, 255, 255, 255, /**/ 118, 76, 42, 0, 0),
    );
    expect(p.kind === 'summary' && p.records).toEqual([
      { ts: t, systolic: 120, diastolic: 80, stress: 35, glucose: 5.2, hrv: 60 },
      { ts: t + 1800, systolic: 118, diastolic: 76, stress: 42, glucose: null, hrv: null },
    ]);
  });
  it('давление с сист. <= диаст. не принимается', () => {
    const p = parsePacket(pkt(0x55, ...u32(t), 80, 80, 30, 0, 0));
    expect(p.kind === 'summary' && p.records[0]).toMatchObject({ systolic: null, diastolic: null, stress: 30 });
  });
});

describe('СИНТЕТИЧЕСКИЕ: остальные пакеты', () => {
  it('0x03 активность', () => {
    const p = parsePacket(pkt(0x03, 0, 0, 0, 0, ...u32(8421), ...u32(6100), ...u32(310)));
    expect(p).toEqual({ kind: 'activity', steps: 8421, distanceM: 6100, calories: 310 });
  });
  it('0x0B заряд', () => {
    expect(parsePacket(pkt(0x0b, 87))).toEqual({ kind: 'battery', percent: 87 });
  });
  it('0x20 функции: биты 29, 81, 83', () => {
    const mask = new Array(12).fill(0);
    for (const bit of [29, 81, 83]) mask[bit >> 3] |= 1 << (bit & 7);
    const p = parsePacket(pkt(0x20, ...mask));
    expect(p.kind).toBe('functions');
    if (p.kind === 'functions') {
      expect(hasFunction(p.mask, FUNCTION_BIT.spo2Measure)).toBe(true);
      expect(hasFunction(p.mask, FUNCTION_BIT.spo2Offline)).toBe(true);
      expect(hasFunction(p.mask, FUNCTION_BIT.stress)).toBe(true);
      expect(hasFunction(p.mask, FUNCTION_BIT.splitBpSpo2)).toBe(false);
    }
  });
  it('0x19 принято, 0x99 отказ, 0x90/0x91 конец архива', () => {
    expect(parsePacket(pkt(0x19))).toEqual({ kind: 'autoMeasureAck', accepted: true });
    expect(parsePacket(pkt(0x99))).toEqual({ kind: 'autoMeasureAck', accepted: false });
    expect(parsePacket(pkt(0x90))).toEqual({ kind: 'archiveEnd' });
    expect(parsePacket(pkt(0x91))).toEqual({ kind: 'archiveEnd' });
  });
  it('мусор не роняет разбор', () => {
    expect(parsePacket(new Uint8Array([]))).toEqual({ kind: 'unknown', code: -1 });
    expect(parsePacket(new Uint8Array([0x7f, 1]))).toEqual({ kind: 'unknown', code: 0x7f });
    expect(parsePacket(new Uint8Array([0x40, 1, 2])).kind).toBe('unknown');
  });
});

describe('команды', () => {
  it('все команды ровно 20 байт', () => {
    for (const c of [setTimeCommand(0, 0), autoMeasureCommand(), archiveCommand('spo2', 1)]) {
      expect(c).toHaveLength(20);
    }
  });
  it('0x19: окно 00:00–23:59, включено, период 30', () => {
    expect(Array.from(autoMeasureCommand(30).slice(0, 8))).toEqual([0x19, 0, 0, 23, 59, 1, 30, 1]);
  });
  it('0x01: локальное время = epoch + зона, зона в часах', () => {
    const nowMs = Date.parse('2026-09-19T12:00:00Z');
    const c = setTimeCommand(nowMs, 3 * 3600);
    const local = (c[1] | (c[2] << 8) | (c[3] << 16) | (c[4] << 24)) >>> 0;
    expect(formatWall(local)).toBe('2026-09-19 15:00:00');
    expect(c[5]).toBe(3);
  });
  it('0x01: отрицательная зона кодируется как int8', () => {
    expect(setTimeCommand(0, -5 * 3600)[5]).toBe(251);
  });
  it('запрос архива: код и день назад', () => {
    expect(Array.from(archiveCommand('spo2', 2).slice(0, 3))).toEqual([0x40, 2, 0]);
    expect(Array.from(archiveCommand('summary', 0).slice(0, 2))).toEqual([0x55, 0]);
  });
});
