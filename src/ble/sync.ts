import {
  activityCommand,
  archiveCommand,
  autoMeasureCommand,
  batteryCommand,
  parsePacket,
  prepareArchiveCommand,
  setTimeCommand,
  type HeartSample,
  type Sample,
  type SummaryRecord,
} from '../codec';
import { sleep, type Transport } from './transport';

/** Пауза после последнего пакета = конец выгрузки. */
export const IDLE_MS = 2000;
/** Сколько ждём ПЕРВЫЙ пакет: кольцу нужно время поднять данные из памяти. */
export const FIRST_PACKET_MS = 2500;
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

export interface SyncResult {
  steps: Sample[];
  sleep: Sample[];
  heart: HeartSample[];
  spo2: Sample[];
  summary: SummaryRecord[];
  /** Сводка за сегодня от кольца (0x03), если пришла. */
  activity: { steps: number; distanceM: number; calories: number } | null;
  /** Заряд в процентах (0x0B). */
  battery: number | null;
  /** Сколько пакетов пришло по каждому виду данных — для диагностики. */
  packetCounts: Record<ArchiveKind, number>;
}

export interface SyncOptions {
  /** Сколько дней выгружать: 0 — только сегодня, 7 — сегодня и 6 предыдущих (как в main.py). */
  days?: number;
  onProgress?: (message: string) => void;
}

/**
 * Выгрузка архивов по дням.
 *
 * Важно: кольцо отвечает не строго на «свою» команду. На запрос шагов (0x10) оно присылает
 * сначала весь сон за этот день (0x11), а потом шаги; на сам запрос 0x11 приходит только
 * пустое подтверждение. Поэтому входящие пакеты разбираются одним обработчиком и
 * раскладываются по виду данных, а не по тому, какой запрос сейчас ждёт ответа.
 * Запросы при этом отправляются все — как описано в PROTOCOL.md.
 */
export async function runSync(t: Transport, options: SyncOptions = {}): Promise<SyncResult> {
  const days = options.days ?? 7;
  const say = options.onProgress ?? (() => {});
  const result: SyncResult = {
    steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
  };

  /** Признаки активности кольца для текущего запроса. */
  let lastRx = 0;
  let seen = 0;
  let finished = false;
  let dayEnd = false;

  const off = t.onPacket((d) => {
    const p = parsePacket(d);
    let isData = false;
    switch (p.kind) {
      case 'steps':
      case 'sleep':
        result[p.kind].push(...p.samples);
        result.packetCounts[p.kind]++;
        isData = true;
        break;
      case 'heart':
        if (p.phase === 'data') {
          result.heart.push(...p.samples);
          result.packetCounts.heart++;
          isData = true;
        } else if (p.phase === 'end') {
          finished = true;
        }
        break;
      case 'spo2':
        result.spo2.push(...p.samples);
        result.packetCounts.spo2++;
        if (p.isDayEnd) dayEnd = true;
        isData = true;
        break;
      case 'summary':
        result.summary.push(...p.records);
        result.packetCounts.summary++;
        isData = true;
        break;
      case 'battery':
        result.battery = p.percent;
        break;
      case 'activity':
        result.activity = { steps: p.steps, distanceM: p.distanceM, calories: p.calories };
        break;
      case 'archiveEnd':
        finished = true;
        break;
    }
    if (isData) {
      seen++;
      lastRx = Date.now();
    }
  });

  /** Отправляет запрос и ждёт, пока кольцо замолчит. Данные копит обработчик выше. */
  const request = async (kind: ArchiveKind, day: number, firstPacketMs: number, retries = 0) => {
    let got = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      seen = 0;
      finished = false;
      dayEnd = false;
      lastRx = 0;
      const started = Date.now();
      await t.send(archiveCommand(kind, day));
      for (;;) {
        await sleep(POLL_MS);
        const now = Date.now();
        if (seen === 0) {
          if (finished || now - started > firstPacketMs) break;
        } else {
          if (finished || now - lastRx > IDLE_MS) break;
          if (dayEnd && now - lastRx > DAY_END_GRACE_MS) break;
        }
      }
      got = seen;
      if (got > 0) break;
    }
    await sleep(GAP_BETWEEN_REQUESTS_MS);
    return got;
  };

  try {
    await t.send(prepareArchiveCommand());
    await sleep(500);
    for (let day = 0; day < days; day++) {
      say(`День −${day}`);
      for (const kind of ['steps', 'sleep', 'heart'] as const) {
        await request(kind, day, FIRST_PACKET_MS);
      }
      // 0x40 (кислород) не запрашиваем: кольцо отдаёт его редко и ненадёжно.
      // Разбор пакета остался в кодеке на случай, если понадобится вернуть.
      await request('summary', day, FIRST_PACKET_MS);
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
