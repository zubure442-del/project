import { dateKey, nowRingTs, wallClock, type Sample, type SummaryRecord } from '../codec';
import type { SyncResult } from '../ble/sync';
import {
  CONSISTENCY_WINDOW_DAYS,
  PERSONAL_BASELINE_DAYS,
  STEPS_DEFAULT_NORM,
  STEP_HISTORY_DAYS,
  WEIGHTS,
  activeCalories,
  activityScore,
  applyStepNoise,
  buildCycles,
  dayLoad,
  dayOrganism,
  organismSamples,
  personalBaseline,
  wakeMinuteOf,
  type Baseline,
  type Body,
  type ComponentId,
  buildSleepSessions,
  cleanHeart,
  computeDayScore,
  nightHrOf,
  sleepHrBaseline,
  sleepHrCategory,
  sleepHrFactor,
  type NightHr,
  SLEEP_HR_BASELINE_DAYS,
  hypnogramSegments,
  nightForDate,
  resolveStepNorm,
  sleepMinutes,
  sleepScore,
  stepsByHour,
  type StoredNorm,
} from '../domain';
import { CACHE_DAYS, SNAPSHOT_DAYS, type CycleSnapshot, type DayPoint, type DaySnapshot } from './types';

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
 * Личный ориентир «Организма» на дату: по семи прошлым дням — средняя вариабельность
 * и минимальный пульс за день. Сам день не входит.
 */
function organismBaselines(
  summaryByDate: Map<string, SummaryRecord[]>,
  heartByDate: Map<string, Sample[]>,
): (date: string) => Baseline {
  const dailyHrv = new Map(
    [...summaryByDate].map(([date, list]) => {
      const values = list.map((r) => r.hrv).filter((v): v is number => v !== null);
      return [date, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null] as const;
    }),
  );
  const dailyPulse = new Map([...heartByDate].map(([date, list]) => [date, Math.min(...list.map((s) => s.value))] as const));
  return (date: string) =>
    personalBaseline(
      Array.from({ length: PERSONAL_BASELINE_DAYS }, (_, i) => shiftDate(date, -(PERSONAL_BASELINE_DAYS - i)))
        .map((d) => ({ hrv: dailyHrv.get(d) ?? null, pulse: dailyPulse.get(d) ?? null }))
        .filter((d) => d.hrv !== null || d.pulse !== null),
    );
}

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

  const baselineFor = organismBaselines(summaryByDate, heartByDate);
  const nowTs = nowRingTs(now.getTime(), -now.getTimezoneOffset() * 60);
  const today = dateKey(nowTs);
  const nowMinute = minuteOfDay(nowTs);

  // Дни — по порядку: сну нужны подъёмы прошлых дней, вчерашняя оценка активности
  // и своя норма ночного пульса по семи предыдущим дням.
  const wakeByDate = new Map<string, number>();
  const activityByDate = new Map<string, number | null>();
  const nightHrByDate = new Map<string, NightHr>();
  /** Ночи семи предыдущих дней — из них считается своя норма ночного пульса. */
  const nightsBefore = (date: string): NightHr[] =>
    Array.from({ length: SLEEP_HR_BASELINE_DAYS }, (_, i) => nightHrByDate.get(shiftDate(date, -(SLEEP_HR_BASELINE_DAYS - i))))
      .filter((v): v is NightHr => v !== undefined);

  const snapshots: DaySnapshot[] = [];
  for (const date of [...dates].sort()) {
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
    // Пульс во сне: минимум и среднее по замерам внутри ночи, дальше — сравнение со своей нормой.
    const nightHr = night
      ? nightHrOf(heart.filter((s) => s.ts >= night.start && s.ts <= night.end).map((s) => s.value))
      : null;
    const baselineHr = sleepHrBaseline(nightsBefore(date));
    const category =
      nightHr && baselineHr ? sleepHrCategory(nightHr.min - baselineHr.min, nightHr.avg - baselineHr.avg) : null;
    const sleepContext = {
      previousWakes: Array.from({ length: CONSISTENCY_WINDOW_DAYS }, (_, i) => wakeByDate.get(shiftDate(date, -(i + 1))))
        .filter((v): v is number => v !== undefined),
      yesterdayActivity: activityByDate.get(shiftDate(date, -1)) ?? null,
      nightHrFactor: sleepHrFactor(category),
    };
    const stepNorm = resolveStepNorm(norms[date], historyBefore(date), sleepScore(night, sleepContext));
    const score = computeDayScore({ night, steps, heart, age, organism: organism.score, stepGoal: stepNorm.value, sleepContext });
    if (night) wakeByDate.set(date, wakeMinuteOf(night));
    if (nightHr) nightHrByDate.set(date, nightHr);
    activityByDate.set(date, score.activity.score);

    snapshots.push({
      date,
      total: score.total,
      scores: { sleep: score.sleep.score, activity: score.activity.score, state: score.state.score },
      steps,
      sleep: night ? { totalMin: sleepMinutes(night), deepMin: night.deepMin, lightMin: night.lightMin } : null,
      restingHr: score.restingHr?.value ?? null,
      restingHrSource: score.restingHr?.source ?? null,
      nightHr,
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
      load: dayLoad(toPoints(heart), toPoints(stepSamples ?? []), age, score.restingHr?.value ?? null),
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

/**
 * Циклы бодрствования и их оценки (domain/cycles.ts). Аналитика — по циклу, а не по суткам:
 * - сон — сессия, которой цикл начался (та же модель, что у дня: длительность, глубина, подъём,
 *   бонус за активность прошлого цикла, коэффициент ночного пульса против своей нормы за 7 дней);
 * - организм — замеры от засыпания до конца цикла (или до «сейчас»): ночь и текущее состояние;
 * - активность — шаги (после шумоподавления) и пульс внутри цикла против нормы шагов даты начала.
 * У цикла без сна (после таймаута, снятого кольца или до первого сна) итога нет.
 * `horizon` — кольцевая метка, до которой есть данные: конец текущего цикла.
 */
export function buildCycleSnapshots(
  sync: SyncResult,
  age: number | null,
  days: readonly DaySnapshot[],
  horizon: number,
): { cycles: CycleSnapshot[]; ringOffSince: number | null } {
  const sessions = buildSleepSessions(sync.sleep);
  const { clean } = cleanHeart(sync.heart);
  const measurements = [...sync.heart.map((s) => s.ts), ...sync.spo2.map((s) => s.ts), ...sync.summary.map((r) => r.ts)];
  const starts = [...measurements, ...sync.steps.map((s) => s.ts), ...sessions.map((s) => s.start)];
  const dataStart = starts.length ? Math.min(...starts) : null;
  const { cycles, ringOffSince } = buildCycles({ sessions, measurements, dataStart, horizon });

  const baselineFor = organismBaselines(groupByDate(sync.summary), groupByDate(clean));
  const dayOf = (date: string) => days.find((d) => d.date === date) ?? null;
  const within = <T extends { ts: number }>(items: readonly T[], from: number, to: number) =>
    items.filter((x) => x.ts >= from && x.ts <= to);

  const out: CycleSnapshot[] = [];
  for (const cycle of cycles) {
    const until = cycle.end ?? horizon;
    const date = dateKey(cycle.start);
    const base = midnightTs(date);
    const night = cycle.sleep;
    const previous = out[out.length - 1] ?? null;
    const weekBefore = out.filter((c) => c.date < date && c.date >= shiftDate(date, -SLEEP_HR_BASELINE_DAYS));

    // Сон цикла.
    const nightHr = night ? nightHrOf(within(clean, night.start, night.end).map((s) => s.value)) : null;
    const baselineHr = sleepHrBaseline(weekBefore.map((c) => c.nightHr).filter((v): v is NightHr => v !== null));
    const category =
      nightHr && baselineHr ? sleepHrCategory(nightHr.min - baselineHr.min, nightHr.avg - baselineHr.avg) : null;
    // Постоянство подъёма — по главному сну каждого из прошлых дней (самому длинному), без дневной дрёмы.
    const mainWake = new Map<string, { minutes: number; wake: number }>();
    for (const c of out) {
      if (!c.sleep || c.date >= date || c.date < shiftDate(date, -CONSISTENCY_WINDOW_DAYS)) continue;
      const known = mainWake.get(c.date);
      if (!known || c.sleep.totalMin > known.minutes) {
        mainWake.set(c.date, { minutes: c.sleep.totalMin, wake: minuteOfDay(c.sleep.end) });
      }
    }
    const sleep = sleepScore(night, {
      previousWakes: [...mainWake.values()].map((w) => w.wake),
      yesterdayActivity: previous?.scores.activity ?? null,
      nightHrFactor: sleepHrFactor(category),
    });

    // Организм: от засыпания до конца цикла — ночь и текущее состояние.
    const from = night ? night.start : cycle.start;
    const rel = (ts: number) => (ts - from) / 60;
    const heartWindow = within(clean, from, until);
    const samples = organismSamples(
      within(sync.summary, from, until).map((r) => ({
        m: rel(r.ts), systolic: r.systolic, diastolic: r.diastolic, glucose: r.glucose, hrv: r.hrv,
      })),
      heartWindow.map((s) => ({ m: rel(s.ts), v: s.value })),
      within(sync.spo2, from, until).map((s) => ({ m: rel(s.ts), v: s.value })),
    );
    const organism = dayOrganism(samples, baselineFor(date), rel(until)).score;

    // Активность: шаги и пульс внутри цикла против нормы шагов даты начала.
    const stepsInside = within(sync.steps, cycle.start, until);
    const steps = applyStepNoise(stepsInside.reduce((sum, s) => sum + s.value, 0));
    const heartInside = within(clean, cycle.start, until);
    const activity = activityScore(steps, heartInside, age, dayOf(date)?.stepNorm?.value ?? STEPS_DEFAULT_NORM);

    const scores: Record<ComponentId, number | null> = {
      sleep: sleep === null ? null : Math.round(sleep),
      activity: activity === null ? null : Math.round(activity),
      state: organism === null ? null : Math.round(organism),
    };
    const ids = Object.keys(WEIGHTS) as ComponentId[];
    const weightSum = ids.reduce((sum, k) => sum + WEIGHTS[k], 0);
    const total = ids.every((k) => scores[k] !== null)
      ? Math.round(ids.reduce((sum, k) => sum + WEIGHTS[k] * (scores[k] as number), 0) / weightSum)
      : null;
    const minuteOf = (ts: number) => Math.round((ts - base) / 60);

    out.push({
      date,
      start: cycle.start,
      end: cycle.end,
      startedBy: cycle.startedBy,
      endedBy: cycle.endedBy,
      before: cycle.before,
      total,
      scores,
      steps,
      sleep: night
        ? { start: night.start, end: night.end, totalMin: sleepMinutes(night), deepMin: night.deepMin, lightMin: night.lightMin }
        : null,
      sleepSegments: night
        ? hypnogramSegments(within(sync.sleep, night.start, night.end)).map((seg) => ({
            from: (seg.from - base) / 60,
            to: (seg.to - base) / 60,
            stage: seg.stage,
          }))
        : [],
      nightHr,
      chart:
        cycle.end === null
          ? {
              from: minuteOf(cycle.start),
              to: minuteOf(until),
              heart: heartInside.map((s) => ({ m: minuteOf(s.ts), v: s.value })),
              steps: stepsInside.map((s) => ({ m: minuteOf(s.ts), v: s.value })),
              restingHr: dayOf(date)?.restingHr ?? null,
            }
          : null,
    });
  }
  // Храним две недели, как и сводки дней: для динамики и истории.
  const newest = out.length ? out[out.length - 1].date : null;
  const kept = newest ? out.filter((c) => c.date >= shiftDate(newest, -(SNAPSHOT_DAYS - 1))) : out;
  return { cycles: kept, ringOffSince };
}

/** Кэш хранит две последние недели сводок: неделя на экране и неделя для сравнения. */
export function keepLastDays(days: DaySnapshot[]): DaySnapshot[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-SNAPSHOT_DAYS);
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
