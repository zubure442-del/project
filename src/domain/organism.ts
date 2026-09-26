import { SPO2_PENALTY, SPO2_TARGET } from './score';

/**
 * «Организм» v2 — среднее состояние тела за день.
 * Замер — один момент (пакет 0x55 плюс ближайший кислород), где известно хотя бы два показателя
 * из пяти. Вариабельность и пульс сравниваются с личным ориентиром, остальное — с абсолютными порогами.
 * Оценка дня — среднее замеров, взвешенное по времени, которое каждый покрывает.
 */

export const ORGANISM_MIN_INPUTS_PER_SAMPLE = 2;
/** Личный ориентир: среднее за столько последних дней с данными, но только если таких дней не меньше минимума. */
export const PERSONAL_BASELINE_DAYS = 7;
export const PERSONAL_BASELINE_MIN_DAYS = 5;
export const DEFAULT_HRV_BASELINE_MS = 50;
export const DEFAULT_PULSE_BASELINE_BPM = 65;
/** Чувствительность подоценок к отклонению от ориентира. */
export const HRV_DEVIATION_K = 200;
export const PULSE_DEVIATION_K = 300;
export const ORGANISM_WEIGHTS = { hrv: 0.3, pulse: 0.25, oxygen: 0.2, bp: 0.15, glucose: 0.1 } as const;
/** Сколько времени покрывает один замер: период автозамера кольца. */
export const ORGANISM_SAMPLE_COVER_MIN = 30;
/** День без такого покрытия замерами оценки не получает. */
export const ORGANISM_MIN_COVERAGE_HOURS = 4;
/** Кислород берём ближайший по времени, но не дальше этого. */
export const OXYGEN_MATCH_MIN = 15;
/** Абсолютные пороги давления и глюкозы — прежние, из ALGORITHMS.md («Метаболизм»). */
export const GLUCOSE_OK = 5.2;
export const GLUCOSE_PENALTY = 40;
export const BP_OK = { systolic: 120, diastolic: 80 } as const;
export const BP_BORDER = { systolic: 130, diastolic: 85 } as const;
export const BP_BORDER_SCORE = 70;
export const BP_PENALTY = 5;

export type OrganismInput = keyof typeof ORGANISM_WEIGHTS;

export interface OrganismSample {
  /** Минута дня. */
  m: number;
  hrv: number | null;
  /** Минимальный пульс за день на этот момент. */
  pulse: number | null;
  oxygen: number | null;
  systolic: number | null;
  diastolic: number | null;
  glucose: number | null;
}

export interface Baseline {
  hrv: number;
  pulse: number;
}

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/** Личный ориентир по прошлым дням (сегодня не входит); мало дней — запасные значения. */
export function personalBaseline(history: readonly { hrv: number | null; pulse: number | null }[]): Baseline {
  const recent = history.slice(-PERSONAL_BASELINE_DAYS);
  const mean = (values: number[], fallback: number) =>
    values.length >= PERSONAL_BASELINE_MIN_DAYS ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
  return {
    hrv: mean(recent.map((d) => d.hrv).filter((v): v is number => v !== null), DEFAULT_HRV_BASELINE_MS),
    pulse: mean(recent.map((d) => d.pulse).filter((v): v is number => v !== null), DEFAULT_PULSE_BASELINE_BPM),
  };
}

export const hrvSubScore = (value: number, baseline: number) =>
  clamp(50 + ((value - baseline) / baseline) * HRV_DEVIATION_K);
/** Пульс: ниже ориентира — лучше. */
export const pulseSubScore = (value: number, baseline: number) =>
  clamp(50 + ((baseline - value) / baseline) * PULSE_DEVIATION_K);
export const oxygenSubScore = (value: number) =>
  value >= SPO2_TARGET ? 100 : clamp(100 - (SPO2_TARGET - value) * SPO2_PENALTY);
export const glucoseSubScore = (value: number) =>
  value <= GLUCOSE_OK ? 100 : clamp(100 - (value - GLUCOSE_OK) * GLUCOSE_PENALTY);
export function bpSubScore(systolic: number, diastolic: number): number {
  if (systolic < BP_OK.systolic && diastolic < BP_OK.diastolic) return 100;
  if (systolic <= BP_BORDER.systolic && diastolic <= BP_BORDER.diastolic) return BP_BORDER_SCORE;
  return clamp(100 - (systolic - BP_BORDER.systolic) * BP_PENALTY);
}

/** Подоценки замера — только по тем показателям, что в нём есть. */
export function subScores(s: OrganismSample, baseline: Baseline): Partial<Record<OrganismInput, number>> {
  const out: Partial<Record<OrganismInput, number>> = {};
  if (s.hrv !== null) out.hrv = hrvSubScore(s.hrv, baseline.hrv);
  if (s.pulse !== null) out.pulse = pulseSubScore(s.pulse, baseline.pulse);
  if (s.oxygen !== null) out.oxygen = oxygenSubScore(s.oxygen);
  if (s.systolic !== null && s.diastolic !== null) out.bp = bpSubScore(s.systolic, s.diastolic);
  if (s.glucose !== null) out.glucose = glucoseSubScore(s.glucose);
  return out;
}

/** Оценка замера: веса нормируются по тем показателям, что есть; меньше двух — оценки нет. */
export function sampleScore(s: OrganismSample, baseline: Baseline): number | null {
  const parts = Object.entries(subScores(s, baseline)) as [OrganismInput, number][];
  if (parts.length < ORGANISM_MIN_INPUTS_PER_SAMPLE) return null;
  const weight = parts.reduce((sum, [k]) => sum + ORGANISM_WEIGHTS[k], 0);
  return parts.reduce((sum, [k, v]) => sum + ORGANISM_WEIGHTS[k] * v, 0) / weight;
}

/**
 * Замеры дня: по одному на каждую запись 0x55, плюс ближайший кислород (±15 мин)
 * и минимальный пульс за день к этому моменту.
 */
export function organismSamples(
  summary: readonly { m: number; systolic: number | null; diastolic: number | null; glucose: number | null; hrv: number | null }[],
  heart: readonly { m: number; v: number }[],
  oxygen: readonly { m: number; v: number }[],
): OrganismSample[] {
  return [...summary]
    .sort((a, b) => a.m - b.m)
    .map((r) => {
      const seen = heart.filter((p) => p.m <= r.m).map((p) => p.v);
      const near = oxygen
        .filter((p) => Math.abs(p.m - r.m) <= OXYGEN_MATCH_MIN)
        .sort((a, b) => Math.abs(a.m - r.m) - Math.abs(b.m - r.m))[0];
      return {
        m: r.m,
        hrv: r.hrv,
        pulse: seen.length ? Math.min(...seen) : null,
        oxygen: near ? near.v : null,
        systolic: r.systolic,
        diastolic: r.diastolic,
        glucose: r.glucose,
      };
    });
}

/** Подоценка показателя сегодня и обычная (среднее по прошлым дням), 0–100: что тянет «Организм». */
export type OrganismParts = Partial<Record<OrganismInput, { today: number; usual: number }>>;
/** Обычная подоценка — по стольким прошлым дням с замерами, не меньше. */
export const ORGANISM_PARTS_MIN_DAYS = 2;

/**
 * Составляющие «Организма» сегодня против обычного — теми же подоценками, что и сама оценка
 * (для «Мнения Лиса»: «Организм ниже нормы: просела вариабельность пульса»). Прошлые дни — массивы
 * замеров по дням; показатель без замеров сегодня или без двух прошлых дней не попадает.
 */
export function organismParts(
  today: readonly OrganismSample[],
  past: readonly (readonly OrganismSample[])[],
  baseline: Baseline,
): OrganismParts {
  const means = (samples: readonly OrganismSample[]) => {
    const sums: Partial<Record<OrganismInput, number[]>> = {};
    for (const s of samples) for (const [k, v] of Object.entries(subScores(s, baseline)) as [OrganismInput, number][]) (sums[k] ??= []).push(v);
    return Object.fromEntries(
      Object.entries(sums).map(([k, list]) => [k, (list as number[]).reduce((a, b) => a + b, 0) / (list as number[]).length]),
    ) as Partial<Record<OrganismInput, number>>;
  };
  const now = means(today);
  const days = past.map(means);
  const out: OrganismParts = {};
  for (const key of Object.keys(ORGANISM_WEIGHTS) as OrganismInput[]) {
    const history = days.map((d) => d[key]).filter((v): v is number => v !== undefined);
    const value = now[key];
    if (value === undefined || history.length < ORGANISM_PARTS_MIN_DAYS) continue;
    out[key] = { today: value, usual: history.reduce((a, b) => a + b, 0) / history.length };
  }
  return out;
}

/**
 * Оценка дня: среднее замеров, взвешенное по покрытию (до следующего замера, не больше 30 минут;
 * последний — до конца дня или до текущего момента для сегодня). Меньше 4 часов покрытия — оценки нет.
 */
export function dayOrganism(
  samples: readonly OrganismSample[],
  baseline: Baseline,
  endMinute = 1440,
): { score: number | null; coverageMin: number } {
  const scored = samples
    .map((s) => ({ m: s.m, score: sampleScore(s, baseline) }))
    .filter((s): s is { m: number; score: number } => s.score !== null)
    .sort((a, b) => a.m - b.m);
  let weighted = 0;
  let coverage = 0;
  scored.forEach((s, i) => {
    const until = i + 1 < scored.length ? scored[i + 1].m : endMinute;
    const cover = Math.max(0, Math.min(ORGANISM_SAMPLE_COVER_MIN, until - s.m));
    weighted += s.score * cover;
    coverage += cover;
  });
  const enough = coverage >= ORGANISM_MIN_COVERAGE_HOURS * 60;
  return { score: enough && coverage > 0 ? weighted / coverage : null, coverageMin: coverage };
}
