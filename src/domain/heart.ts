import type { Sample } from '../codec/types';

/** Порты из main.py (get_clean_hr, smooth_hr). Метки — секунды. */
export const HR_GLITCH_JUMP = 30;
export const HR_GLITCH_RETURN = 15;
export const HR_GLITCH_MAX_RUN = 2;
/** 40 минут: с запасом для автозамера раз в 15–30 минут. */
export const HR_GLITCH_MAX_GAP = 2400;
export const HR_SMOOTH_HALF_WINDOW = 2700;
export const HR_SMOOTH_MAX_GAP = 5400;

export interface Glitch {
  ts: number;
  value: number;
  before: number;
  after: number;
}

const byTime = (a: Sample, b: Sample) => a.ts - b.ts;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Убирает одиночные (до 2 подряд) скачки пульса на 30+ уд/мин, после которых пульс
 * возвращается к прежнему уровню. Исходный массив не меняется.
 * Последний замер проверить нельзя (нет следующего), он остаётся.
 */
export function cleanHeart(input: Sample[], maxGap = HR_GLITCH_MAX_GAP) {
  const items = [...input].sort(byTime);
  const n = items.length;
  const glitches: Glitch[] = [];
  let good = 0;
  let i = 1;
  while (i < n) {
    const base = items[good];
    const cur = items[i];
    if (cur.ts - base.ts > maxGap || Math.abs(cur.value - base.value) < HR_GLITCH_JUMP) {
      good = i;
      i++;
      continue;
    }
    const direction = cur.value > base.value ? 1 : -1;
    let matchedEnd: number | null = null;
    for (let run = 1; run <= HR_GLITCH_MAX_RUN; run++) {
      const j = i + run;
      if (j >= n) break;
      const segment = items.slice(i, j);
      if (segment.some((s) => direction * (s.value - base.value) < HR_GLITCH_JUMP)) break;
      let gapTooBig = false;
      for (let k = i; k <= j; k++) if (items[k].ts - items[k - 1].ts > maxGap) gapTooBig = true;
      if (gapTooBig) break;
      if (Math.abs(items[j].value - base.value) <= HR_GLITCH_RETURN) {
        matchedEnd = j;
        break;
      }
    }
    if (matchedEnd === null) {
      good = i; // не сбой: пульс действительно изменился
      i++;
    } else {
      for (let k = i; k < matchedEnd; k++) {
        glitches.push({ ts: items[k].ts, value: items[k].value, before: base.value, after: items[matchedEnd].value });
      }
      i = matchedEnd;
    }
  }
  const bad = new Set(glitches.map((g) => g.ts));
  return { clean: items.filter((s) => !bad.has(s.ts)), glitches };
}

/** Скользящая медиана по времени, окно ±45 минут. */
export function smoothHeart(input: Sample[], halfWindow = HR_SMOOTH_HALF_WINDOW): Sample[] {
  const items = [...input].sort(byTime);
  return items.map((s) => ({
    ts: s.ts,
    value: median(items.filter((o) => Math.abs(o.ts - s.ts) <= halfWindow).map((o) => o.value)),
  }));
}

/** Делит линию на куски: разрыв больше 90 минут — линию не тянем. */
export function splitSegments(points: Sample[], maxGap = HR_SMOOTH_MAX_GAP): Sample[][] {
  const out: Sample[][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && p.ts - last[last.length - 1].ts <= maxGap) last.push(p);
    else out.push([p]);
  }
  return out;
}
