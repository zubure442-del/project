import { describe, expect, it } from 'vitest';
import {
  INITIAL_PROGRESS,
  STAGE_MIN_MS,
  STAGE_TAIL_MS,
  canLeave,
  nextShownStage,
  realPercent,
  shownPercent,
  type LoadProgress,
  type ShownStage,
} from './loading';

const at = (p: Partial<LoadProgress>): LoadProgress => ({ ...INITIAL_PROGRESS, ...p });

/** Прогоняет экран тиками по 100 мс, пока идёт реальный ход `timeline(t)`. */
function play(timeline: (t: number) => LoadProgress, untilMs: number) {
  let shown: ShownStage = { stage: 1, since: 0 };
  const changes: [number, number][] = [[0, 1]];
  let left: number | null = null;
  for (let t = 0; t <= untilMs; t += 100) {
    const next = nextShownStage(shown, timeline(t), t);
    if (next !== shown) changes.push([t, next.stage]);
    shown = next;
    if (left === null && canLeave(shown, timeline(t), t)) left = t;
  }
  return { changes, left };
}

describe('СИНТЕТИЧЕСКИЕ: этапы экрана загрузки', () => {
  it('этап не обгоняет реальный ход загрузки', () => {
    const { changes } = play((t) => at({ stage: t < 1000 ? 1 : 2, fraction: 0.3 }), 20000);
    expect(changes).toEqual([
      [0, 1],
      [STAGE_MIN_MS, 2],
    ]);
  });

  it('каждый этап висит не меньше 2.5 с, пока загрузка идёт', () => {
    // Реально: связь за 0.5 с, выгрузка до 12 с, расчёт и запись — ещё 0.2 с.
    const real = (t: number) =>
      t < 500 ? at({ stage: 1 }) : t < 12000 ? at({ stage: 2 }) : t < 12100 ? at({ stage: 3 }) : at({ stage: 4 });
    const { changes } = play(real, 11900);
    expect(changes).toEqual([
      [0, 1],
      [2500, 2],
    ]);
  });

  it('после конца загрузки оставшиеся этапы пролетают быстро: экран не держит дольше нужного', () => {
    const real = (t: number) => (t < 5000 ? at({ stage: 2 }) : at({ stage: 4, finished: true }));
    const { changes, left } = play(real, 20000);
    expect(changes).toEqual([
      [0, 1],
      [2500, 2],
      [5000, 3],
      [5000 + STAGE_TAIL_MS, 4],
    ]);
    expect(left).toBe(5000 + 2 * STAGE_TAIL_MS);
  });

  it('процент только растёт и не выше границы показанного этапа', () => {
    const shown1: ShownStage = { stage: 1, since: 0 };
    const shown2: ShownStage = { stage: 2, since: 0 };
    expect(shownPercent(0, shown1, at({ stage: 2, fraction: 0.5 }))).toBe(0.1);
    expect(shownPercent(0.1, shown2, at({ stage: 2, fraction: 0.5 }))).toBeCloseTo(0.5);
    expect(shownPercent(0.5, shown2, at({ stage: 2, fraction: 0.2 }))).toBe(0.5);
    expect(realPercent(at({ finished: true }))).toBe(1);
  });
});
