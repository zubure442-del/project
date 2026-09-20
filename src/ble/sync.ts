import {
  activityCommand,
  archiveCommand,
  batteryCommand,
  autoMeasureCommand,
  parsePacket,
  prepareArchiveCommand,
  setTimeCommand,
  type HeartSample,
  type Packet,
  type Sample,
  type SummaryRecord,
} from '../codec';
import { sleep, type Transport } from './transport';

/** Пауза после последнего пакета = конец выгрузки. */
export const IDLE_MS = 2000;
/** Сколько ждём ПЕРВЫЙ пакет: кольцу нужно время поднять данные из памяти. */
export const FIRST_PACKET_MS = 2500;
export const FIRST_PACKET_SPO2_MS = 4000;
const GAP_BETWEEN_REQUESTS_MS = 500;
const DAY_END_GRACE_MS = 500;
const ACK_TIMEOUT_MS = 5000;
const POLL_MS = 50;

export type AutoMeasureResult = 'accepted' | 'rejected' | 'noreply';

/**
 * Начало каждого подключения. Порядок важен: сначала 0x01 (время), потом 0x19 (автозамер),
 * иначе кольцо перестаёт писать SpO2. Если ответа на 0x19 нет — одна повторная попытка.
 */
export async function handshake(t: Transport, now = Date.now(), tzOffsetSeconds = -new Date().getTimezoneOffset() * 60) {
  await t.send(setTimeCommand(now, tzOffsetSeconds));
  await sleep(1000);
  let result: AutoMeasureResult = 'noreply';
  for (let attempt = 0; attempt < 2 && result === 'noreply'; attempt++) {
    let ack: boolean | null = null;
    const off = t.onPacket((d) => {
      const p = parsePacket(d);
      if (p.kind === 'autoMeasureAck') ack = p.accepted;
    });
    await t.send(autoMeasureCommand(30));
    const started = Date.now();
    while (ack === null && Date.now() - started < ACK_TIMEOUT_MS) await sleep(POLL_MS);
    off();
    if (ack !== null) result = ack ? 'accepted' : 'rejected';
  }
  return { autoMeasure: result };
}

type ArchiveKind = 'steps' | 'sleep' | 'heart' | 'spo2' | 'summary';

interface Collected {
  packets: Packet[];
  answered: boolean;
}

/** Отправляет запрос архива и собирает ответы до паузы IDLE_MS (или служебного конца). */
async function collect(
  t: Transport,
  kind: ArchiveKind,
  day: number,
  firstPacketMs: number,
  retries: number,
): Promise<Collected> {
  const wanted = kind === 'heart' ? 'heart' : kind;
  let packets: Packet[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    packets = [];
    let lastRx = 0;
    let finished = false;
    let dayEnd = false;
    const off = t.onPacket((d) => {
      const p = parsePacket(d);
      if (p.kind === 'archiveEnd' || (p.kind === 'heart' && p.phase === 'end')) finished = true;
      if (p.kind !== wanted) return;
      packets.push(p);
      lastRx = Date.now();
      if (p.kind === 'spo2' && p.isDayEnd) dayEnd = true;
    });
    const started = Date.now();
    await t.send(archiveCommand(kind, day));
    for (;;) {
      await sleep(POLL_MS);
      const now = Date.now();
      if (packets.length === 0) {
        if (finished || now - started > firstPacketMs) break;
      } else {
        if (finished || now - lastRx > IDLE_MS) break;
        if (dayEnd && now - lastRx > DAY_END_GRACE_MS) break;
      }
    }
    off();
    if (packets.length > 0) break;
  }
  await sleep(GAP_BETWEEN_REQUESTS_MS);
  return { packets, answered: packets.length > 0 };
}

export interface SyncResult {
  steps: Sample[];
  sleep: Sample[];
  heart: HeartSample[];
  spo2: Sample[];
  summary: SummaryRecord[];
  /** Сводка за сегодня от кольца (0x03), если пришла. */
  activity: { steps: number; distanceM: number; calories: number } | null;
  /** Заряд, если кольцо прислало его само. */
  battery: number | null;
  /** Сколько пакетов пришло по каждому виду данных — для диагностики. */
  packetCounts: Record<ArchiveKind, number>;
}

export interface SyncOptions {
  /** Сколько дней выгружать: 0 — только сегодня, 7 — сегодня и 6 предыдущих (как в main.py). */
  days?: number;
  onProgress?: (message: string) => void;
}

/** Выгрузка архивов по дням. Дубли по метке времени схлопываются (позже пришедшее заменяет). */
export async function runSync(t: Transport, options: SyncOptions = {}): Promise<SyncResult> {
  const days = options.days ?? 7;
  const say = options.onProgress ?? (() => {});
  const result: SyncResult = {
    steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
  };
  const off = t.onPacket((d) => {
    const p = parsePacket(d);
    if (p.kind === 'battery') result.battery = p.percent;
    if (p.kind === 'activity') result.activity = { steps: p.steps, distanceM: p.distanceM, calories: p.calories };
  });

  try {
    await t.send(prepareArchiveCommand());
    await sleep(500);
    let spo2Answered = false;
    for (let day = 0; day < days; day++) {
      say(`День −${day}`);
      for (const kind of ['steps', 'sleep', 'heart'] as const) {
        const c = await collect(t, kind, day, FIRST_PACKET_MS, 0);
        for (const p of c.packets) {
          if (p.kind === 'steps' || p.kind === 'sleep') result[p.kind].push(...p.samples);
          if (p.kind === 'heart' && p.phase === 'data') result.heart.push(...p.samples);
        }
        result.packetCounts[kind] += c.packets.length;
      }
      const patient = spo2Answered || day === 0;
      const s = await collect(t, 'spo2', day, patient ? FIRST_PACKET_SPO2_MS : FIRST_PACKET_MS, patient ? 1 : 0);
      if (s.answered) spo2Answered = true;
      for (const p of s.packets) if (p.kind === 'spo2') result.spo2.push(...p.samples);
      result.packetCounts.spo2 += s.packets.length;

      const m = await collect(t, 'summary', day, FIRST_PACKET_MS, 0);
      for (const p of m.packets) if (p.kind === 'summary') result.summary.push(...p.records);
      result.packetCounts.summary += m.packets.length;
    }
    // 0x03 — активность за сегодня, 0x0B — заряд. Оба разовые, не по дням (PROTOCOL.md, раздел 3).
    await t.send(activityCommand());
    await sleep(1000);
    await t.send(batteryCommand());
    await sleep(1000);
  } finally {
    off();
  }

  result.steps = dedupe(result.steps);
  result.sleep = dedupe(result.sleep);
  result.heart = dedupe(result.heart);
  result.spo2 = dedupe(result.spo2);
  result.summary = [...new Map(result.summary.map((r) => [r.ts, r])).values()].sort((a, b) => a.ts - b.ts);
  return result;
}

function dedupe<T extends Sample>(items: T[]): T[] {
  return [...new Map(items.map((s) => [s.ts, s])).values()].sort((a, b) => a.ts - b.ts);
}
