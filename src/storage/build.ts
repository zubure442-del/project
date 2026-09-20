import { dateKey, wallClock, type Sample, type SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import { buildSleepSessions, cleanHeart, computeDayScore, hypnogramSegments, nightForDate, sleepMinutes, stepsByHour } from '../domain';
import { HISTORY_DAYS, type DayPoint, type DaySnapshot } from './types';

const minuteOfDay = (ts: number) => {
  const w = wallClock(ts);
  return w.hour * 60 + w.minute;
};

const toPoints = (samples: Sample[]): DayPoint[] =>
  samples.map((s) => ({ m: minuteOfDay(s.ts), v: Math.round(s.value * 10) / 10 }));

const groupByDate = <T extends { ts: number }>(items: T[]): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = dateKey(item.ts);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
};

/** Полночь дня как кольцевая метка: метки кольца — это «настенное» время в UTC. */
const midnightTs = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

function average(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}

/**
 * Превращает выгрузку в сводки по дням. Чистая функция: расчёты те же, что на экране.
 * Дни без единого показателя пропускаются — пустая карточка пользователю не нужна.
 */
export function buildSnapshots(sync: SyncResult, age: number | null): DaySnapshot[] {
  const sessions = buildSleepSessions(sync.sleep);
  const { clean } = cleanHeart(sync.heart);
  const heartByDate = groupByDate(clean);
  const stepsByDate = groupByDate(sync.steps);
  const summaryByDate = groupByDate(sync.summary);

  const dates = new Set<string>([
    ...heartByDate.keys(), ...stepsByDate.keys(), ...summaryByDate.keys(),
    ...sessions.map((s) => s.date),
  ]);

  const snapshots: DaySnapshot[] = [];
  for (const date of dates) {
    const heart = heartByDate.get(date) ?? [];
    const stepSamples = stepsByDate.get(date);
    const steps = stepSamples ? stepSamples.reduce((sum, s) => sum + s.value, 0) : null;
    const { night } = nightForDate(sessions, date);
    const summary: SummaryRecord[] = summaryByDate.get(date) ?? [];
    const pick = (key: keyof SummaryRecord) =>
      average(summary.map((r) => r[key]).filter((v): v is number => v !== null));

    const score = computeDayScore({
      night,
      steps,
      heart,
      age,
      hrv: summary.map((r) => r.hrv).filter((v): v is number => v !== null),
    });

    snapshots.push({
      date,
      total: score.total,
      scores: { sleep: score.sleep.score, activity: score.activity.score, state: score.state.score },
      steps,
      sleep: night ? { totalMin: sleepMinutes(night), deepMin: night.deepMin, lightMin: night.lightMin } : null,
      restingHr: score.restingHr?.value ?? null,
      restingHrSource: score.restingHr?.source ?? null,
      stateInputs: score.stateInputs,
      heart: toPoints(heart),
      stress: toPoints(
        summary.filter((r) => r.stress !== null).map((r) => ({ ts: r.ts, value: r.stress as number })),
      ),
      summaryPoints: summary.map((r) => ({
        m: minuteOfDay(r.ts),
        systolic: r.systolic,
        diastolic: r.diastolic,
        glucose: r.glucose,
        hrv: r.hrv,
      })),
      stepsByHour: stepsByHour(stepSamples ?? []),
      sleepSegments: night
        ? hypnogramSegments(sync.sleep.filter((s) => s.ts >= night.start && s.ts <= night.end)).map((seg) => ({
            from: (seg.from - midnightTs(date)) / 60,
            to: (seg.to - midnightTs(date)) / 60,
            stage: seg.stage,
          }))
        : [],
      estimates: {
        hrv: pick('hrv'),
        glucose: pick('glucose'),
        systolic: pick('systolic'),
        diastolic: pick('diastolic'),
        stress: pick('stress'),
      },
    });
  }
  return snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

/** Кэш хранит одну последнюю синхронизацию: оставляем её последние дни. */
export function keepLastDays(days: DaySnapshot[]): DaySnapshot[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_DAYS);
}
