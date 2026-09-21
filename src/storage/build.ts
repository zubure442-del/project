import { dateKey, nowRingTs, wallClock, type Sample, type SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import {
  PERSONAL_BASELINE_DAYS,
  STEP_HISTORY_DAYS,
  activeCalories,
  applyStepNoise,
  dayOrganism,
  organismSamples,
  personalBaseline,
  type Body,
  buildSleepSessions,
  cleanHeart,
  computeDayScore,
  hypnogramSegments,
  nightForDate,
  resolveStepNorm,
  sleepMinutes,
  sleepScore,
  stepsByHour,
  type StoredNorm,
} from '../domain';
import { CACHE_DAYS, HISTORY_DAYS, type DayPoint, type DaySnapshot } from './types';

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

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Превращает выгрузку в сводки по дням. Чистая функция: расчёты те же, что на экране.
 * Дни без единого показателя пропускаются — пустая карточка пользователю не нужна.
 */
export function buildSnapshots(
  sync: SyncResult,
  age: number | null,
  /** Сохранённые нормы шагов по дням: посчитанная норма в течение дня не меняется. */
  norms: Readonly<Record<string, StoredNorm>> = {},
  /** Биометрия для калорий; null — калории не считаем. */
  body: Body | null = null,
  /** Текущий момент: последний замер сегодняшнего дня покрывает время только до него. */
  now = new Date(),
): DaySnapshot[] {
  const sessions = buildSleepSessions(sync.sleep);
  const { clean } = cleanHeart(sync.heart);
  const heartByDate = groupByDate(clean);
  const stepsByDate = groupByDate(sync.steps);
  const summaryByDate = groupByDate(sync.summary);
  const spo2ByDate = groupByDate(sync.spo2);

  const dates = new Set<string>([
    ...heartByDate.keys(), ...stepsByDate.keys(), ...summaryByDate.keys(), ...spo2ByDate.keys(),
    ...sessions.map((s) => s.date),
  ]);

  // Шаги за день после шумоподавления — для истории нормы: семь дней до этого дня, сам день не входит.
  const totals = new Map(
    [...stepsByDate].map(([date, list]) => [date, applyStepNoise(list.reduce((sum, s) => sum + s.value, 0))]),
  );
  const historyBefore = (date: string) =>
    Array.from({ length: STEP_HISTORY_DAYS }, (_, i) => totals.get(shiftDate(date, -(STEP_HISTORY_DAYS - i))))
      .filter((v): v is number => v !== undefined);

  // Личный ориентир «Организма»: по прошлым дням — средняя вариабельность и минимальный пульс за день.
  const dailyHrv = new Map(
    [...summaryByDate].map(([date, list]) => {
      const values = list.map((r) => r.hrv).filter((v): v is number => v !== null);
      return [date, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null] as const;
    }),
  );
  const dailyPulse = new Map([...heartByDate].map(([date, list]) => [date, Math.min(...list.map((s) => s.value))] as const));
  const baselineFor = (date: string) =>
    personalBaseline(
      Array.from({ length: PERSONAL_BASELINE_DAYS }, (_, i) => shiftDate(date, -(PERSONAL_BASELINE_DAYS - i)))
        .map((d) => ({ hrv: dailyHrv.get(d) ?? null, pulse: dailyPulse.get(d) ?? null }))
        .filter((d) => d.hrv !== null || d.pulse !== null),
    );
  const nowTs = nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60);
  const today = dateKey(nowTs);
  const nowMinute = minuteOfDay(nowTs);

  const snapshots: DaySnapshot[] = [];
  for (const date of dates) {
    const heart = heartByDate.get(date) ?? [];
    const spo2 = spo2ByDate.get(date) ?? [];
    const stepSamples = stepsByDate.get(date);
    // Дневная сумма — после шумоподавления; почасовые и поминутные ряды остаются сырыми.
    const steps = stepSamples ? applyStepNoise(stepSamples.reduce((sum, s) => sum + s.value, 0)) : null;
    const { night } = nightForDate(sessions, date);
    const summary: SummaryRecord[] = summaryByDate.get(date) ?? [];
    const pick = (key: keyof SummaryRecord) =>
      average(summary.map((r) => r[key]).filter((v): v is number => v !== null));

    const samples = organismSamples(
      summary.map((r) => ({ m: minuteOfDay(r.ts), systolic: r.systolic, diastolic: r.diastolic, glucose: r.glucose, hrv: r.hrv })),
      toPoints(heart),
      toPoints(spo2),
    );
    const organism = dayOrganism(samples, baselineFor(date), date === today ? nowMinute : 1440);
    const stepNorm = resolveStepNorm(norms[date], historyBefore(date), sleepScore(night));
    const score = computeDayScore({ night, steps, heart, age, organism: organism.score, stepGoal: stepNorm.value });

    snapshots.push({
      date,
      total: score.total,
      scores: { sleep: score.sleep.score, activity: score.activity.score, state: score.state.score },
      steps,
      sleep: night ? { totalMin: sleepMinutes(night), deepMin: night.deepMin, lightMin: night.lightMin } : null,
      restingHr: score.restingHr?.value ?? null,
      restingHrSource: score.restingHr?.source ?? null,
      stateInputs: {
        hrv: samples.some((x) => x.hrv !== null),
        restingHr: samples.some((x) => x.pulse !== null),
        spo2: samples.some((x) => x.oxygen !== null),
      },
      heart: toPoints(heart),
      spo2: toPoints(spo2),
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
      stepNorm,
      calories: activeCalories(toPoints(stepSamples ?? []), toPoints(heart), body),
      stepsByHour: stepsByHour(stepSamples ?? []),
      stepsByMinute: toPoints(stepSamples ?? []),
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

/** Нормы шагов из новых сводок поверх сохранённых. Храним не больше CACHE_DAYS дней. */
export function collectStepNorms(
  previous: Readonly<Record<string, StoredNorm>>,
  days: readonly DaySnapshot[],
): Record<string, StoredNorm> {
  const next: Record<string, StoredNorm> = { ...previous };
  for (const day of days) if (day.stepNorm) next[day.date] = day.stepNorm;
  const kept = Object.keys(next).sort().slice(-CACHE_DAYS);
  return Object.fromEntries(kept.map((d) => [d, next[d]]));
}
