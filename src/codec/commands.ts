import { command } from './bytes';

export const CMD = {
  setTime: 0x01,
  profile: 0x02,
  activity: 0x03,
  battery: 0x0b,
  prepareArchive: 0x13,
  liveHeart: 0x14,
  liveMode: 0x23,
  steps: 0x10,
  sleep: 0x11,
  heart: 0x16,
  autoMeasure: 0x19,
  functions: 0x20,
  spo2: 0x40,
  summary: 0x55,
} as const;

export const AUTO_MEASURE_PERIODS = [15, 30, 45, 60] as const;
export type AutoMeasurePeriod = (typeof AUTO_MEASURE_PERIODS)[number];

/** 0x01: [1..4] локальное время (epoch + зона) uint32 LE, [5] смещение зоны в часах. */
export function setTimeCommand(nowMs: number, tzOffsetSeconds: number): Uint8Array {
  const local = Math.floor(nowMs / 1000) + tzOffsetSeconds;
  return command(
    CMD.setTime,
    local,
    local >>> 8,
    local >>> 16,
    local >>> 24,
    Math.floor(tzOffsetSeconds / 3600),
  );
}

/** 0x19: автозамер пульса и SpO2, окно 00:00–23:59. Отправлять при КАЖДОМ подключении, после 0x01. */
export function autoMeasureCommand(periodMin: AutoMeasurePeriod = 30): Uint8Array {
  return command(CMD.autoMeasure, 0, 0, 23, 59, 1, periodMin % 255, 1);
}

/**
 * 0x02 — профиль пользователя.
 * [1] возраст, у мужчин старший бит выставлен; [2] рост в см; [3] вес в кг; [4] 0 — метрические единицы.
 * Пример: мужчина 30 лет, 180 см, 80 кг -> 02 9E B4 50 00.
 */
export function profileCommand(input: { age: number; heightCm: number; weightKg: number; male: boolean }): Uint8Array {
  const age = input.age & 0x7f;
  return command(CMD.profile, input.male ? age | 0x80 : age, input.heightCm, input.weightKg, 0);
}

/** 0x23 — режим живого замера: 0 выключить, 1 давление, 2 кислород, 3 глюкоза. */
export const liveModeCommand = (mode: 0 | 1 | 2 | 3): Uint8Array => command(CMD.liveMode, mode);

/** Запрос архива за день: 0 — сегодня, 1 — вчера и т.д. */
export function archiveCommand(
  kind: 'steps' | 'sleep' | 'heart' | 'spo2' | 'summary',
  dayOffset: number,
): Uint8Array {
  return command(CMD[kind], dayOffset);
}

/** 0x13 — перед выгрузкой архивов (эксперимент, в SDK нет, но так делает рабочий main.py). */
export const prepareArchiveCommand = (): Uint8Array => command(CMD.prepareArchive);
export const activityCommand = (): Uint8Array => command(CMD.activity);
/** 0x0B — заряд. Кольцо присылает процент и само, но PROTOCOL.md описывает запрос. */
export const batteryCommand = (): Uint8Array => command(CMD.battery);
export const functionsCommand = (): Uint8Array => command(CMD.functions);
