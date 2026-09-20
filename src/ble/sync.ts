import {
  activityCommand,
  archiveCommand,
  autoMeasureCommand,
  type AutoMeasurePeriod,
  batteryCommand,
  parsePacket,
  liveModeCommand,
  prepareArchiveCommand,
  profileCommand,
  setTimeCommand,
  type HeartSample,
  type Sample,
  type SummaryRecord,
} from '../codec';
import { sleep, type Transport } from './transport';

/**
 * Запасная пауза: конец потока определяем по маркеру 23:45 и счётчику aa,
 * а по тишине — только если признака не было. Внутри потока бывают паузы до 2.7 с.
 */
export const IDLE_MS = 5000;
/** Сколько ждём ПЕРВЫЙ пакет: кольцо поднимает данные из памяти до 8 секунд. */
export const FIRST_PACKET_MS = 12000;
/** Тишина после повтора: дальше считаем запрос неудачным и идём к следующему. */
export const STALL_MS = 10000;
/** Сколько ждём после последней отметки aa, чтобы забрать хвост данных. */
const TAIL_MS = 500;
/** Лёгкие запросы (0x13, 0x03, 0x0B) не чаще одного раза в это время. */
export const LIGHT_REQUEST_MS = 5000;
const lightSentAt = new Map<number, number>();

/** Сбрасывает счётчик лёгких запросов. Нужен в тестах и после переподключения. */
export const resetLightThrottle = () => lightSentAt.clear();

/** Отправляет лёгкую команду, если её недавно уже не отправляли. */
async function sendLight(t: Transport, packet: Uint8Array): Promise<boolean> {
  const code = packet[0];
  const last = lightSentAt.get(code) ?? 0;
  if (Date.now() - last < LIGHT_REQUEST_MS) return false;
  lightSentAt.set(code, Date.now());
  await t.send(packet);
  return true;
}
const GAP_BETWEEN_REQUESTS_MS = 500;
const DAY_END_GRACE_MS = 500;
const ACK_TIMEOUT_MS = 5000;
const POLL_MS = 50;

export type AutoMeasureResult = 'accepted' | 'rejected' | 'noreply';

/**
 * Начало каждого подключения. Порядок важен: сначала 0x01 (время), потом 0x19 (автозамер),
 * иначе кольцо перестаёт писать SpO2. Если ответа на 0x19 нет — одна повторная попытка.
 */
export interface RingProfile {
  age: number;
  heightCm: number;
  weightKg: number;
  male: boolean;
}

export async function handshake(
  t: Transport,
  profile: RingProfile | null = null,
  autoMeasureMin: AutoMeasurePeriod = 30,
  now = Date.now(),
  tzOffsetSeconds = -new Date().getTimezoneOffset() * 60,
) {
  await t.send(setTimeCommand(now, tzOffsetSeconds));
  await sleep(1000);
  let result: AutoMeasureResult = 'noreply';
  for (let attempt = 0; attempt < 2 && result === 'noreply'; attempt++) {
    let ack: boolean | null = null;
    const off = t.onPacket((d) => {
      const p = parsePacket(d);
      if (p.kind === 'autoMeasureAck') ack = p.accepted;
    });
    await t.send(autoMeasureCommand(autoMeasureMin));
    const started = Date.now();
    while (ack === null && Date.now() - started < ACK_TIMEOUT_MS) await sleep(POLL_MS);
    off();
    if (ack !== null) result = ack ? 'accepted' : 'rejected';
  }
  // Профиль уходит после 0x01 и 0x19, как в официальном клиенте. Пустой профиль не отправляем.
  if (profile) {
    await t.send(profileCommand(profile));
    await sleep(300);
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

/** Этапы, которые показывает экран приветствия. */
export type SyncStage = 'connecting' | 'configuring' | 'loading';

export interface SyncOptions {
  /** С какого дня начинать: 0 — сегодня. */
  fromDay?: number;
  /** Сколько дней выгружать подряд. */
  days?: number;
  /** Запрашивать разовые 0x03 и 0x0B. На промежуточной фазе не нужно. */
  extras?: boolean;
  /** Жёсткий предел на всю фазу. По истечении новые запросы не отправляем. */
  hardCapMs?: number;
  onStage?: (stage: SyncStage) => void;
  /** Доля выполненных запросов, 0..1. Растёт по мере ответов кольца. */
  onProgress?: (fraction: number) => void;
  /** Каждый пришедший пакет с данными — для анимации. */
  onPacket?: () => void;
  /** Данные по мере прихода: экран обновляется, не дожидаясь конца фазы. */
  onData?: (partial: SyncResult) => void;
}

/** Запросов на один день: шаги, сон, пульс, сводка. */
const REQUESTS_PER_DAY = 4;

/** Объединяет выгрузки двух фаз в одну. */
export function mergeSyncResults(a: SyncResult, b: SyncResult): SyncResult {
  const byTs = <T extends { ts: number }>(x: T[], y: T[]) =>
    [...new Map([...x, ...y].map((s) => [s.ts, s])).values()].sort((p, q) => p.ts - q.ts);
  return {
    steps: byTs(a.steps, b.steps),
    sleep: byTs(a.sleep, b.sleep),
    heart: byTs(a.heart, b.heart),
    spo2: byTs(a.spo2, b.spo2),
    summary: byTs(a.summary, b.summary),
    activity: b.activity ?? a.activity,
    battery: b.battery ?? a.battery,
    packetCounts: {
      steps: a.packetCounts.steps + b.packetCounts.steps,
      sleep: a.packetCounts.sleep + b.packetCounts.sleep,
      heart: a.packetCounts.heart + b.packetCounts.heart,
      spo2: a.packetCounts.spo2 + b.packetCounts.spo2,
      summary: a.packetCounts.summary + b.packetCounts.summary,
    },
  };
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
  const fromDay = options.fromDay ?? 0;
  const extras = options.extras ?? true;
  const totalRequests = days * REQUESTS_PER_DAY + (extras ? 2 : 0);
  let doneRequests = 0;
  const report = () => options.onProgress?.(Math.min(1, doneRequests / totalRequests));
  const result: SyncResult = {
    steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
  };

  /** Признаки активности кольца для текущего запроса. */
  let lastRx = 0;
  let seen = 0;
  let finished = false;
  let dayEnd = false;
  let busy = false;
  let heartExpected = 0;
  let heartMarks = 0;
  let lastMarkAt = 0;

  const off = t.onPacket((d) => {
    const p = parsePacket(d);
    let isData = false;
    switch (p.kind) {
      case 'steps':
      case 'sleep':
        // Сон приходит в окне запроса шагов: разбираем по коду пакета, а не по запросу.
        result[p.kind].push(...p.samples);
        result.packetCounts[p.kind]++;
        if (p.isDayEnd) dayEnd = true;
        isData = true;
        break;
      case 'heart':
        if (p.phase === 'data') {
          result.heart.push(...p.samples);
          result.packetCounts.heart++;
          isData = true;
        } else if (p.phase === 'start') {
          heartExpected = p.expected;
          heartMarks = 0;
        } else if (p.phase === 'mark') {
          heartMarks++;
          lastMarkAt = Date.now();
        } else {
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
        if (p.isDayEnd) dayEnd = true;
        isData = true;
        break;
      case 'battery':
        result.battery = p.percent;
        break;
      case 'activity':
        result.activity = { steps: p.steps, distanceM: p.distanceM, calories: p.calories };
        break;
      case 'livePulse':
        result.heart.push({ ts: p.ts, value: p.value, raw: [p.value] });
        isData = true;
        break;
      case 'busy':
        // Кольцо занято: ждём, повторять запрос бессмысленно.
        busy = true;
        lastRx = Date.now();
        break;
      case 'archiveEnd':
        finished = true;
        break;
    }
    if (isData) {
      seen++;
      lastRx = Date.now();
      options.onPacket?.();
    }
  });

  const startedAt = Date.now();
  const outOfTime = () => options.hardCapMs !== undefined && Date.now() - startedAt > options.hardCapMs;

  /**
   * Отправляет запрос и ждёт конца потока: маркер 23:45, счётчик отметок aa
   * или тишина IDLE_MS. Повтор — только если за FIRST_PACKET_MS не пришло ничего
   * и кольцо не ответило «занято».
   */
  const request = async (kind: ArchiveKind, day: number, retries = 1) => {
    if (outOfTime()) {
      doneRequests++;
      report();
      return 0;
    }
    let got = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      seen = 0;
      finished = false;
      dayEnd = false;
      busy = false;
      heartExpected = 0;
      heartMarks = 0;
      lastMarkAt = 0;
      lastRx = 0;
      const started = Date.now();
      await t.send(archiveCommand(kind, day));
      for (;;) {
        await sleep(POLL_MS);
        const now = Date.now();
        const heartDone = heartExpected > 0 && heartMarks >= heartExpected && now - lastMarkAt > TAIL_MS;
        if (finished || heartDone) break;
        if (dayEnd && now - lastRx > DAY_END_GRACE_MS) break;
        if (seen === 0) {
          const limit = attempt === 0 ? FIRST_PACKET_MS : STALL_MS;
          // Пока кольцо говорит «занято», ждём: повторять запрос бессмысленно.
          if (busy ? now - lastRx > STALL_MS : now - started > limit) break;
        } else if (now - lastRx > IDLE_MS) {
          break;
        }
      }
      got = seen;
      // Явный конец потока (16 ff) — это ответ, а не молчание: повторять незачем.
      if (got > 0 || busy || finished) break;
    }
    await sleep(GAP_BETWEEN_REQUESTS_MS);
    doneRequests++;
    report();
    return got;
  };

  try {
    options.onStage?.('loading');
    await sendLight(t, prepareArchiveCommand());
    await sleep(500);
    for (let i = 0; i < days; i++) {
      const day = fromDay + i;
      // 0x11 не запрашиваем: на него приходит только пустая заглушка,
      // а сам сон кольцо отдаёт в окне запроса шагов.
      for (const kind of ['steps', 'heart', 'summary', 'spo2'] as const) {
        await request(kind, day);
      }
    }
    if (extras) {
      // 0x03 — активность за сегодня, 0x0B — заряд. Оба разовые, не по дням (PROTOCOL.md, раздел 3).
      await sendLight(t, activityCommand());
      await sleep(1000);
      doneRequests++;
      report();
      await sendLight(t, batteryCommand());
      await sleep(1000);
      doneRequests++;
      report();
    }
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

/**
 * Один живой замер: кольцо включает оптику и присылает 0x24 с пульсом и давлением.
 * Порядок режимов и признак готовности взяты из reference/main.py, пункт 2 меню.
 * Если замер не удался (кольцо снято, рука двигается), возвращаем null и ничего не пишем.
 */
export async function liveMeasure(t: Transport, timeoutMs = 45000): Promise<{ pulse: number } | null> {
  let pulse: number | null = null;
  const off = t.onPacket((d) => {
    const p = parsePacket(d);
    if (p.kind === 'livePulse') pulse = p.value;
    if (p.kind === 'liveBiometrics' && p.pulse > 0) pulse = p.pulse;
  });
  try {
    await t.send(liveModeCommand(2));
    const started = Date.now();
    while (pulse === null && Date.now() - started < timeoutMs) await sleep(500);
    if (pulse === null) {
      await t.send(liveModeCommand(1));
      const second = Date.now();
      while (pulse === null && Date.now() - second < timeoutMs) await sleep(500);
    }
    return pulse === null ? null : { pulse };
  } finally {
    await t.send(liveModeCommand(0)).catch(() => undefined);
    off();
  }
}
