import { u32le } from './bytes';
import { CMD } from './commands';
import { MIN_VALID_TS, wallClock } from './time';
import type { HeartSample, Packet, Sample, SummaryRecord } from './types';

const NO_DATA = 255;
const SPO2_MIN = 1;
const SPO2_MAX = 100;
const HR_MIN = 30;
const HR_MAX = 220;

/** Округление «к чётному», как round() в Python: 77.5 → 78, 78.5 → 78. Нужно для совпадения с main.py. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Пульс за минуту: медиана подзамеров 30–220 (не среднее). null, если годных нет. */
export function heartFromSamples(samples: ArrayLike<number>): number | null {
  const valid = Array.from(samples).filter((x) => x >= HR_MIN && x <= HR_MAX);
  return valid.length ? roundHalfEven(median(valid)) : null;
}

/** 0x40: [1..4] начало 15-минутного слота, [5..19] SpO2 по минутам. */
export function parseSpo2(data: Uint8Array): Packet | null {
  if (data.length < 6) return null;
  const ts = u32le(data, 1);
  if (ts <= MIN_VALID_TS) return null;
  const isDayEnd = isDayEndTs(ts);

  let minutes: Sample[] = [];
  for (let i = 0; i < Math.min(15, data.length - 5); i++) {
    const v = data[5 + i];
    if (v !== NO_DATA && v >= SPO2_MIN && v <= SPO2_MAX) minutes.push({ ts: ts + i * 60, value: v });
  }
  // Кольцо кладёт в слот ОДИН замер, продублированный на все минуты: это одна точка.
  if (new Set(minutes.map((m) => m.value)).size === 1) minutes = minutes.slice(0, 1);
  return { kind: 'spo2', slotStart: ts, isDayEnd, samples: minutes };
}

/**
 * Конец суток: пакет с меткой 23:45:00. Так кольцо помечает последний пакет потока
 * у 0x10, 0x55 и 0x40 — проверено на живом кольце 21.09.2026.
 */
export function isDayEndTs(ts: number): boolean {
  const w = wallClock(ts);
  return w.hour === 23 && w.minute === 45 && w.second === 0;
}

/**
 * 0x16: подкоманда в [1]: 0xF0 заголовок, 0xAA отметка, 0xFF конец,
 * 0xA0 данные ([2..5] ts, две минуты по 6 подзамеров).
 * В заголовке байт 6 — сколько будет отметок aa; по ним и считаем конец потока.
 */
export function parseHeart(data: Uint8Array): Packet | null {
  if (data.length < 2) return null;
  const sub = data[1];
  if (sub === 0xf0) return { kind: 'heart', phase: 'start', expected: data.length > 6 ? data[6] : 0 };
  if (sub === 0xaa) return { kind: 'heart', phase: 'mark', index: data[2] };
  if (sub === 0xff) return { kind: 'heart', phase: 'end' };
  if (sub !== 0xa0 || data.length < 20) return null;
  const ts = u32le(data, 2);
  if (ts <= MIN_VALID_TS) return null;

  const samples: HeartSample[] = [];
  const first = Array.from(data.subarray(8, 14));
  const second = Array.from(data.subarray(14, 20));
  const v1 = heartFromSamples(first);
  if (v1 !== null) samples.push({ ts, value: v1, raw: first });
  const v2 = heartFromSamples(second);
  if (v2 !== null) samples.push({ ts: ts + 60, value: v2, raw: second });
  return { kind: 'heart', phase: 'data', samples };
}

/** 0x10 (шаги) и 0x11 (сон): [1..4] ts, дальше по байту на минуту, 255 = нет данных. Ноль сохраняется как настоящий ноль. */
export function parseMinuteSeries(data: Uint8Array, kind: 'steps' | 'sleep'): Packet | null {
  if (data.length < 6) return null;
  const ts = u32le(data, 1);
  if (ts <= MIN_VALID_TS) return null;
  const samples: Sample[] = [];
  for (let i = 5; i < data.length; i++) {
    if (data[i] !== NO_DATA) samples.push({ ts: ts + (i - 5) * 60, value: data[i] });
  }
  return { kind, isDayEnd: isDayEndTs(ts), samples };
}

/**
 * 0x55: [1..4] ts, записи по 5 байт: сист., диаст., СТРЕСС (не SpO2!), глюкоза×10, HRV.
 *
 * Проверено на кольце 20.09.2026: все три записи в пакете совпадают, а сами пакеты
 * приходят раз в 30 минут — с периодом автозамера. Это ОДИН замер, продублированный
 * на все слоты, как в 0x40. Тогда берём одну точку по времени первой записи.
 * Если записи различаются, считаем их разными замерами с шагом 15 минут, как в PROTOCOL.md.
 *
 * Ноль замером не считается: официальное приложение усредняет только значения больше нуля,
 * а ноль показывает как «--». В логах кольца нули приходят лишь в служебном пакете 23:45,
 * где вся запись нулевая.
 */
export function parseSummary(data: Uint8Array): Packet | null {
  if (data.length < 6) return null;
  const ts = u32le(data, 1);
  if (ts <= MIN_VALID_TS) return null;

  const count = Math.floor((data.length - 5) / 5);
  const slots: number[][] = [];
  for (let i = 0; i < count; i++) slots.push(Array.from(data.subarray(5 + i * 5, 10 + i * 5)));
  const duplicated = slots.length > 1 && slots.every((slot) => slot.every((b, j) => b === slots[0][j]));
  const entries = duplicated ? slots.slice(0, 1) : slots;

  const records: SummaryRecord[] = [];
  entries.forEach(([sys, dia, stress, sugar, hrv], i) => {
    const bpOk = sys !== NO_DATA && dia !== NO_DATA && sys > dia && dia > 0;
    const rec: SummaryRecord = {
      ts: ts + i * 900,
      systolic: bpOk ? sys : null,
      diastolic: bpOk ? dia : null,
      stress: stress !== NO_DATA && stress > 0 && stress <= 100 ? stress : null,
      glucose: sugar !== NO_DATA && sugar > 0 ? sugar / 10 : null,
      hrv: hrv !== NO_DATA && hrv > 0 ? hrv : null,
    };
    if (rec.systolic !== null || rec.stress !== null || rec.glucose !== null || rec.hrv !== null) {
      records.push(rec);
    }
  });
  return { kind: 'summary', isDayEnd: isDayEndTs(ts), records };
}

/** Разбор любого входящего пакета по коду в байте 0. Никогда не бросает исключений. */
export function parsePacket(data: Uint8Array): Packet {
  if (data.length < 2) return { kind: 'unknown', code: data[0] ?? -1 };
  const code = data[0];
  let parsed: Packet | null = null;
  switch (code) {
    case CMD.spo2:
      parsed = parseSpo2(data);
      break;
    case CMD.heart:
      parsed = parseHeart(data);
      break;
    case CMD.steps:
      parsed = parseMinuteSeries(data, 'steps');
      break;
    case CMD.sleep:
      parsed = parseMinuteSeries(data, 'sleep');
      break;
    case CMD.summary:
      parsed = parseSummary(data);
      break;
    case CMD.activity:
      if (data.length >= 17) {
        parsed = {
          kind: 'activity',
          steps: u32le(data, 5),
          distanceM: u32le(data, 9),
          calories: u32le(data, 13),
        };
      }
      break;
    case CMD.battery:
      parsed = { kind: 'battery', percent: data[1] };
      break;
    case CMD.functions:
      if (data.length >= 13) parsed = { kind: 'functions', mask: data.slice(1, 13) };
      break;
    case CMD.autoMeasure:
      parsed = { kind: 'autoMeasureAck', accepted: true };
      break;
    case 0x99:
      parsed = { kind: 'autoMeasureAck', accepted: false };
      break;
    case 0x06:
      parsed = { kind: 'busy' };
      break;
    case 0x90:
    case 0x91:
      parsed = { kind: 'archiveEnd' };
      break;
  }
  return parsed ?? { kind: 'unknown', code };
}

/** Бит N маски функций (0x20): байт N/8, бит N%8, младший первым. */
export function hasFunction(mask: Uint8Array, bit: number): boolean {
  return ((mask[bit >> 3] >> (bit & 7)) & 1) === 1;
}

export const FUNCTION_BIT = { spo2Measure: 29, spo2Offline: 81, stress: 83, splitBpSpo2: 65 } as const;
