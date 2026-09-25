import {
  activityCommand,
  archiveCommand,
  autoMeasureCommand,
  type AutoMeasurePeriod,
  batteryCommand,
  dateForOffset,
  dateKey,
  nowRingTs,
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
/**
 * Запасная пауза для 0x55 и 0x40. Живой поток этих архивов идёт без пауз: во всех логах
 * (21.09 a–d, 25.09) между пакетами не больше 0.41 с. Замерший поток сам не продолжается:
 * так бывает, пока человек идёт и кольцо само шлёт 03/13 (лог d 19:53, лог 25.09 10:55), —
 * хвост приходит только в окнах следующих запросов. Ждать его 5 с незачем.
 */
export const ARCHIVE_IDLE_MS = 2000;
/** Сколько ждём ПЕРВЫЙ пакет: кольцо поднимает данные из памяти до 8 секунд. */
export const FIRST_PACKET_MS = 12000;
/** Тишина после повтора: дальше считаем запрос неудачным и идём к следующему. */
export const STALL_MS = 10000;
/** Сколько ждём после последней отметки aa: за ней кольцо досылает 1–2 пакета данных (в логе через 30 мс). */
export const TAIL_MS = 300;
/** После маркера 23:45 хвоста не бывает: ждём совсем немного и сразу идём дальше. */
export const DAY_END_GRACE_MS = 100;
/** Пауза между запросами. Раньше была 0.5 с плюс 0.5 с после маркера — 1.3 с на запрос. */
export const GAP_BETWEEN_REQUESTS_MS = 100;
/** Сколько ждём разовый ответ на 0x03 и 0x0B. Кольцо отвечает за 30 мс. */
export const EXTRA_REPLY_MS = 1000;
/** Пауза после 0x13 перед первым запросом архива. */
const PREPARE_PAUSE_MS = 300;
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

/**
 * Как закончился поток. День считается выгруженным целиком, только если все его
 * потоки закрыты явным признаком: маркером 23:45, счётчиком отметок aa или `16 ff`.
 * Пустой день с маркером — тоже завершённый: данных нет, но кольцо это подтвердило.
 */
export type StreamEnd = 'marker' | 'empty' | 'idle' | 'silent' | 'skipped';
export const isExplicitEnd = (end: StreamEnd) => end === 'marker' || end === 'empty';

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
  /** Дни (0 — сегодня), у которых все четыре потока закрыты явным признаком. */
  completeDays: number[];
  /** Выгрузка оборвалась ошибкой связи: данные в результате частичные. */
  error: string | null;
  /** Упёрлись в предел времени: часть запросов не отправлена. */
  capped: boolean;
}

export interface SyncOptions {
  /** Какие дни выгружать: 0 — сегодня, 1 — вчера. По умолчанию только сегодня. */
  days?: number[];
  /**
   * Сегодняшняя дата по часам телефона («2026-09-25»); кольцо живёт по ним же после 0x01.
   * По ней маркер 23:45 сверяется с запрошенным днём. По умолчанию — текущая дата.
   */
  today?: string;
  /** Запрашивать разовые 0x03 и 0x0B. */
  extras?: boolean;
  /** Жёсткий предел на всю выгрузку. По истечении новые запросы не отправляем. */
  hardCapMs?: number;
  /** Доля выполненных запросов, 0..1. Растёт по мере ответов кольца. */
  onProgress?: (fraction: number) => void;
  /** Каждый пришедший пакет с данными — для анимации. */
  onPacket?: () => void;
  /** Строка в отладочный лог: чем закончился каждый день. */
  onNote?: (text: string) => void;
  /**
   * Закончилась очередная часть выгрузки: запрос дня или пара разовых запросов (extras).
   * measured = false — запрос пропущен (предел времени), его длительность не показательна.
   */
  onSegment?: (kind: 'steps' | 'heart' | 'summary' | 'spo2' | 'extras', ms: number, measured: boolean) => void;
}

/** Запросов на один день: шаги (с ними приходит сон), пульс, сводка, кислород. */
const DAY_REQUESTS = ['steps', 'heart', 'summary', 'spo2'] as const;
type DayRequest = (typeof DAY_REQUESTS)[number];
/** Потоки, которые кончаются маркером 23:45 (у пульса — счётчик отметок aa). */
type MarkedStream = Exclude<DayRequest, 'heart'>;
const CODE: Record<DayRequest, string> = { steps: '0x10', heart: '0x16', summary: '0x55', spo2: '0x40' };
const END_TEXT: Record<StreamEnd, string> = {
  marker: 'маркер', empty: 'пусто', idle: 'пауза', silent: 'тишина', skipped: 'пропущен',
};

export const emptySyncResult = (): SyncResult => ({
  steps: [], sleep: [], heart: [], spo2: [], summary: [], activity: null, battery: null,
  packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
  completeDays: [], error: null, capped: false,
});

/**
 * Выгрузка архивов по дням.
 *
 * Важно: кольцо отвечает не строго на «свою» команду. На запрос шагов (0x10) оно присылает
 * вперемешку по времени сон (0x11) и шаги; на сам запрос 0x11 приходит только пустышка.
 * Поэтому входящие пакеты разбираются одним обработчиком и раскладываются по коду пакета.
 * Конец потока — по признаку (свой маркер 23:45: тот же поток и та же дата; счётчик aa; `16 ff`),
 * пауза — только запасной вариант.
 * Ошибка связи не выбрасывается наружу: возвращаем то, что успело прийти, и текст ошибки.
 */
export async function runSync(t: Transport, options: SyncOptions = {}): Promise<SyncResult> {
  const days = options.days ?? [0];
  const today = options.today ?? dateKey(nowRingTs(Date.now(), -new Date().getTimezoneOffset() * 60));
  const extras = options.extras ?? true;
  const totalRequests = days.length * DAY_REQUESTS.length + (extras ? 2 : 0);
  let doneRequests = 0;
  const report = () => options.onProgress?.(Math.min(1, doneRequests / Math.max(1, totalRequests)));
  const result = emptySyncResult();

  /** Признаки активности кольца для текущего запроса. */
  let lastRx = 0;
  let seen = 0;
  let finished = false;
  let busy = false;
  let heartExpected = 0;
  let heartMarks = 0;
  let lastMarkAt = 0;
  let gotActivity = false;
  let gotBattery = false;

  /**
   * Маркеры 23:45 — по потоку и дате («summary:2026-09-25»). Кольцо отвечает с запаздыванием:
   * хвост потока приходит в окне следующего запроса, а замерший поток — даже в следующей выгрузке
   * (лог 25.09). Поэтому запрос закрывает только СВОЙ маркер, а чужой засчитывается своему дню.
   * Маркер потока, который в этой выгрузке не запрашивали, — хвост прошлой: он ничего не подтверждает.
   */
  const requested = new Set<string>();
  const markers = new Set<string>();
  const streamKey = (kind: MarkedStream, date: string) => `${kind}:${date}`;
  const noteMarker = (kind: MarkedStream, ts: number) => {
    const key = streamKey(kind, dateKey(ts));
    if (requested.has(key)) markers.add(key);
  };

  const off = t.onPacket((d) => {
    const p = parsePacket(d);
    let isData = false;
    switch (p.kind) {
      case 'steps':
      case 'sleep':
        // Сон приходит в окне запроса шагов: разбираем по коду пакета, а не по запросу.
        // Последним в окне бывает и пакет сна за 23:45 — он тоже маркер конца.
        result[p.kind].push(...p.samples);
        result.packetCounts[p.kind]++;
        if (p.isDayEnd) noteMarker('steps', p.ts);
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
          lastRx = Date.now();
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
        if (p.isDayEnd) noteMarker('spo2', p.slotStart);
        isData = true;
        break;
      case 'summary':
        result.summary.push(...p.records);
        result.packetCounts.summary++;
        if (p.isDayEnd) noteMarker('summary', p.ts);
        isData = true;
        break;
      case 'battery':
        result.battery = p.percent;
        gotBattery = true;
        break;
      case 'activity':
        result.activity = { steps: p.steps, distanceM: p.distanceM, calories: p.calories };
        gotActivity = true;
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
   * Отправляет запрос и ждёт конца потока: свой маркер 23:45, счётчик отметок aa, `16 ff`
   * или тишина (IDLE_MS, у 0x55 и 0x40 — ARCHIVE_IDLE_MS). Повтор — только если за FIRST_PACKET_MS
   * не пришло ничего и кольцо не ответило «занято».
   */
  const request = async (kind: DayRequest, day: number): Promise<StreamEnd> => {
    const own = kind === 'heart' ? null : streamKey(kind, dateForOffset(day, today));
    if (own) requested.add(own);
    const idleMs = kind === 'summary' || kind === 'spo2' ? ARCHIVE_IDLE_MS : IDLE_MS;
    let end: StreamEnd = 'silent';
    for (let attempt = 0; attempt <= 1; attempt++) {
      seen = 0;
      finished = false;
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
        if (finished) {
          end = seen > 0 ? 'marker' : 'empty';
          break;
        }
        if (heartExpected > 0 && heartMarks >= heartExpected && now - lastMarkAt > TAIL_MS) {
          end = 'marker';
          break;
        }
        if (own && markers.has(own) && now - lastRx > DAY_END_GRACE_MS) {
          end = 'marker';
          break;
        }
        if (seen === 0 && heartExpected === 0) {
          const limit = attempt === 0 ? FIRST_PACKET_MS : STALL_MS;
          // Пока кольцо говорит «занято», ждём: повторять запрос бессмысленно.
          if (busy ? now - lastRx > STALL_MS : now - started > limit) {
            end = 'silent';
            break;
          }
        } else if (now - Math.max(lastRx, lastMarkAt) > idleMs) {
          end = 'idle';
          break;
        }
      }
      // Ответ есть (или кольцо было занято) — повторять незачем.
      if (end !== 'silent' || busy) break;
    }
    await sleep(GAP_BETWEEN_REQUESTS_MS);
    return end;
  };

  /** Ждём разовый ответ, но не дольше EXTRA_REPLY_MS. */
  const waitFor = async (got: () => boolean) => {
    const started = Date.now();
    while (!got() && Date.now() - started < EXTRA_REPLY_MS) await sleep(POLL_MS);
  };

  /** Чем кончился каждый поток выгруженных дней. */
  const processed: { day: number; ends: StreamEnd[] }[] = [];

  try {
    await sendLight(t, prepareArchiveCommand());
    await sleep(PREPARE_PAUSE_MS);
    for (const day of days) {
      // 0x11 не запрашиваем: на него приходит только пустая заглушка,
      // а сам сон кольцо отдаёт в окне запроса шагов.
      const ends: StreamEnd[] = [];
      for (const kind of DAY_REQUESTS) {
        const started = Date.now();
        if (outOfTime()) {
          result.capped = true;
          ends.push('skipped');
          options.onSegment?.(kind, 0, false);
        } else {
          ends.push(await request(kind, day));
          options.onSegment?.(kind, Date.now() - started, true);
        }
        doneRequests++;
        report();
      }
      processed.push({ day, ends });
    }
    if (extras) {
      // 0x03 — активность за сегодня, 0x0B — заряд. Оба разовые, не по дням (PROTOCOL.md, раздел 3).
      const started = Date.now();
      if (await sendLight(t, activityCommand())) await waitFor(() => gotActivity);
      doneRequests++;
      report();
      if (await sendLight(t, batteryCommand())) await waitFor(() => gotBattery);
      doneRequests++;
      report();
      options.onSegment?.('extras', Date.now() - started, true);
    }
  } catch (e) {
    // Обрыв связи: отдаём то, что успело прийти, пусть вызывающий решит, что показать.
    result.error = e instanceof Error ? e.message : String(e);
    options.onNote?.(`выгрузка прервана: ${result.error}`);
  } finally {
    off();
  }

  // Полноту считаем в конце: маркер потока мог прийти позже, в окне другого запроса.
  for (const { day, ends } of processed) {
    const date = dateForOffset(day, today);
    const late = DAY_REQUESTS.map((k, i) => k !== 'heart' && !isExplicitEnd(ends[i]) && markers.has(streamKey(k, date)));
    const closed = ends.every((end, i) => isExplicitEnd(end) || late[i]);
    if (closed) result.completeDays.push(day);
    options.onNote?.(
      `день ${day}: ${closed ? 'завершён' : 'не завершён'} (` +
        DAY_REQUESTS.map((k, i) => `${CODE[k]} ${late[i] ? 'маркер позже' : END_TEXT[ends[i]]}`).join(', ') + ')',
    );
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
export async function liveMeasure(
  t: Transport,
  timeoutMs = 45000,
  /** Прервать замер: например, пользователь запустил обновление. */
  shouldStop: () => boolean = () => false,
): Promise<{ pulse: number } | null> {
  let pulse: number | null = null;
  const off = t.onPacket((d) => {
    const p = parsePacket(d);
    if (p.kind === 'livePulse') pulse = p.value;
    if (p.kind === 'liveBiometrics' && p.pulse > 0) pulse = p.pulse;
  });
  try {
    await t.send(liveModeCommand(2));
    const started = Date.now();
    while (pulse === null && !shouldStop() && Date.now() - started < timeoutMs) await sleep(500);
    if (pulse === null && !shouldStop()) {
      await t.send(liveModeCommand(1));
      const second = Date.now();
      while (pulse === null && !shouldStop() && Date.now() - second < timeoutMs) await sleep(500);
    }
    return pulse === null ? null : { pulse };
  } finally {
    await t.send(liveModeCommand(0)).catch(() => undefined);
    off();
  }
}
