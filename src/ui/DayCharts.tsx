import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import {
  DAY_HOUR_TICKS,
  HR_SMOOTH_MAX_GAP,
  LOAD_BOX_H_FLOOR,
  chartAxis,
  formatMinute,
  loadBoxes,
  loadIntervals,
  smoothHeart,
  splitSegments,
  type SleepStage,
} from '../domain';
import type { DayPoint, DaySnapshot } from '../storage';
import { colors, spacing, withAlpha } from './theme';

const HEIGHT = 130;
const GUTTER = 8;
export const STRESS_MAX_GAP = 45 * 60;

const empty = (width: number, text = 'Нет данных') => (
  <View style={[styles.empty, { width, height: HEIGHT }]}>
    <Text style={styles.emptyText}>{text}</Text>
  </View>
);

/** Шаг подписей шкалы пульса. */
const PULSE_STEP = 20;

/**
 * Пульс за день: сглаженная линия на всю ширину, шкала пульса слева, часы внизу.
 * Поверх линии штрихованные прямоугольники — эпизоды нагрузки.
 */
export type LoadZone = ReturnType<typeof loadIntervals>[number];

export function DayActivityChart({
  heart,
  width,
  age,
  steps = [],
  restingHr = null,
}: {
  heart: DayPoint[];
  width: number;
  age: number | null;
  steps?: { m: number; v: number }[];
  restingHr?: number | null;
}) {
  const smooth = smoothHeart(heart.map((p) => ({ ts: p.m * 60, value: p.v })));
  const zones = loadIntervals(heart.map((p) => ({ m: p.m, v: p.v })), age, steps, restingHr);

  if (smooth.length < 2) return empty(width);

  // Шкала подстраивается под день: фиксированная 60–200 прижимала линию ко дну.
  const values = smooth.map((p) => p.value);
  const yMin = Math.floor((Math.min(...values) - 10) / PULSE_STEP) * PULSE_STEP;
  const yMax = Math.ceil((Math.max(...values) + 20) / PULSE_STEP) * PULSE_STEP;
  const gutter = 34;
  const plot = width - gutter;
  const x = (m: number) => gutter + (m / 1440) * plot;
  // Область графика и запас внутри неё в полквадратика: центр квадратика на линии всегда помещается.
  const area = { top: 10, bottom: HEIGHT - 22 };
  const pad = LOAD_BOX_H_FLOOR / 2;
  const y = (v: number) => area.top + pad + (1 - (v - yMin) / (yMax - yMin)) * (area.bottom - area.top - 2 * pad);
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax; t += PULSE_STEP) ticks.push(t);
  const segments = splitSegments(smooth, HR_SMOOTH_MAX_GAP);

  // График не нажимается и не перехватывает касания: иначе срабатывал при прокрутке.
  return (
    <View pointerEvents="none">
      <Svg width={width} height={HEIGHT}>
        <Defs>
          <Pattern id="load-hatch" patternUnits="userSpaceOnUse" width={6} height={6}>
            <Path d="M0 6 L6 0" stroke={colors.accent} strokeWidth={1.2} strokeOpacity={0.75} />
          </Pattern>
        </Defs>

        {ticks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={gutter} x2={width} y1={y(t)} y2={y(t)} stroke={colors.track} strokeWidth={1} />
            <SvgText x={gutter - 6} y={y(t) + 4} fill={colors.textFaint} fontSize={11} textAnchor="end">
              {t}
            </SvgText>
          </React.Fragment>
        ))}

        {/* Квадратики: центр на линии пульса, высота по числу шагов в эпизоде (loadBoxes). */}
        {loadBoxes(zones, smooth.map((p) => ({ m: p.ts / 60, v: p.value })), x, y, area).map((box, i) => (
          <Rect
            key={i}
            x={box.x}
            y={box.cy - box.height / 2}
            width={box.width}
            height={box.height}
            fill="url(#load-hatch)"
            stroke={colors.accent}
            strokeWidth={1}
            strokeOpacity={0.6}
            rx={2}
          />
        ))}

        {segments.map((seg, i) =>
          seg.length === 1 ? (
            <Circle key={i} cx={x(seg[0].ts / 60)} cy={y(seg[0].value)} r={4} fill={colors.accent} />
          ) : (
            <Path
              key={i}
              d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.ts / 60)} ${y(p.value)}`).join(' ')}
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ),
        )}

        {[0, 360, 720, 1080, 1440].map((m) => (
          <SvgText
            key={m}
            x={x(m)}
            y={HEIGHT - 2}
            fill={colors.textFaint}
            fontSize={11}
            textAnchor={m === 0 ? 'start' : m === 1440 ? 'end' : 'middle'}
          >
            {formatMinute(m)}
          </SvgText>
        ))}
      </Svg>
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
        <Text style={styles.legendText}>Пульс</Text>
        <Svg width={14} height={10}>
          <Defs>
            <Pattern id="legend-hatch" patternUnits="userSpaceOnUse" width={4} height={4}>
              <Path d="M0 4 L4 0" stroke={colors.accent} strokeWidth={1} strokeOpacity={0.75} />
            </Pattern>
          </Defs>
          <Rect x={0.5} y={0.5} width={13} height={9} rx={2} fill="url(#legend-hatch)" stroke={colors.accent} strokeOpacity={0.6} />
        </Svg>
        <Text style={styles.legendText}>Шаги</Text>
      </View>
    </View>
  );
}

/** Пауза, после которой линию не тянем: не меньше 90 минут и не меньше трёх обычных интервалов. */
export function gapFor(points: DayPoint[]): number {
  if (points.length < 3) return 90 * 60;
  const sorted = [...points].sort((a, b) => a.m - b.m);
  const gaps = sorted.slice(1).map((p, i) => (p.m - sorted[i].m) * 60).sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  return Math.max(90 * 60, median * 3);
}

/** Геометрия статичных графиков «Тела». */
const STATIC_HEIGHT = 150;
const STATIC_TOP = 18;
const STATIC_BOTTOM = 20;
const Y_GUTTER = 32;

const tickText = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

interface StaticSeries {
  points: DayPoint[];
  color: string;
}

/**
 * Статичный график дня: подписи Y слева (3–4 круглые отметки, единица у верхней),
 * часы внизу, тонкая сетка. Без нажатий и подсказок — они срабатывали при прокрутке.
 */
function StaticDayChart({
  series,
  width,
  unit,
  fixed,
  guides = [],
}: {
  series: StaticSeries[];
  width: number;
  unit?: string;
  fixed?: { min?: number; max?: number };
  guides?: number[];
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.v));
  if (!all.length) return empty(width);
  const axis = chartAxis(Math.min(...all), Math.max(...all), fixed);
  const plotLeft = Y_GUTTER;
  const plotRight = width - GUTTER;
  const x = (m: number) => plotLeft + (m / 1440) * (plotRight - plotLeft);
  const y = (v: number) =>
    STATIC_TOP + (1 - (v - axis.lo) / Math.max(1e-6, axis.hi - axis.lo)) * (STATIC_HEIGHT - STATIC_TOP - STATIC_BOTTOM);
  const top = axis.ticks[axis.ticks.length - 1];

  return (
    <View pointerEvents="none">
    <Svg width={width} height={STATIC_HEIGHT}>
      {axis.ticks.map((t) => (
        <React.Fragment key={t}>
          <Line x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} stroke={colors.track} strokeWidth={1} />
          <SvgText x={plotLeft - 6} y={y(t) + 4} fill={colors.textFaint} fontSize={11} textAnchor="end">
            {tickText(t)}
          </SvgText>
        </React.Fragment>
      ))}
      {unit ? (
        <SvgText x={plotLeft} y={y(top) - 6} fill={colors.textFaint} fontSize={11}>
          {unit}
        </SvgText>
      ) : null}
      {guides
        .filter((g) => g > axis.lo && g < axis.hi)
        .map((g) => (
          <Line
            key={`g${g}`}
            x1={plotLeft}
            x2={plotRight}
            y1={y(g)}
            y2={y(g)}
            stroke={withAlpha(colors.textFaint, 0.35)}
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}
      {series.flatMap((s, k) => {
        const sorted = [...s.points].sort((p, q) => p.m - q.m);
        return splitSegments(sorted.map((p) => ({ ts: p.m * 60, value: p.v })), gapFor(sorted)).map((seg, i) =>
          seg.length === 1 ? (
            <Circle key={`${k}.${i}`} cx={x(seg[0].ts / 60)} cy={y(seg[0].value)} r={3} fill={s.color} />
          ) : (
            <Path
              key={`${k}.${i}`}
              d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.ts / 60)} ${y(p.value)}`).join(' ')}
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          ),
        );
      })}
      {DAY_HOUR_TICKS.map((m) => (
        <SvgText
          key={m}
          x={x(m)}
          y={STATIC_HEIGHT - 4}
          fill={colors.textFaint}
          fontSize={11}
          textAnchor={m === 0 ? 'start' : m === 1440 ? 'end' : 'middle'}
        >
          {formatMinute(m)}
        </SvgText>
      ))}
    </Svg>
    </View>
  );
}

/** Один показатель за день: стресс, кислород, вариабельность, глюкоза. */
export function DayLineChart({
  points,
  width,
  unit,
  fixed,
  guides,
}: {
  points: DayPoint[];
  width: number;
  unit?: string;
  /** Границы, которые ось охватывает всегда (стресс 0–100, кислород 90–100). */
  fixed?: { min?: number; max?: number };
  /** Пунктирные линии, например границы зон стресса. */
  guides?: number[];
}) {
  return <StaticDayChart series={[{ points, color: colors.accent }]} width={width} unit={unit} fixed={fixed} guides={guides} />;
}

const DIASTOLIC_COLOR = withAlpha(colors.accent, 0.45);

/** Давление: две линии, верхнее и нижнее, и лёгкая легенда под графиком. */
export function PressureChart({ points, width }: { points: { m: number; sys: number; dia: number }[]; width: number }) {
  const series = [
    { points: points.map((p) => ({ m: p.m, v: p.sys })), color: colors.accent },
    { points: points.map((p) => ({ m: p.m, v: p.dia })), color: DIASTOLIC_COLOR },
  ];
  return (
    <View pointerEvents="none">
      <StaticDayChart series={series} width={width} unit="мм рт. ст." />
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
        <Text style={styles.legendText}>верхнее</Text>
        <View style={[styles.swatch, { backgroundColor: DIASTOLIC_COLOR }]} />
        <Text style={styles.legendText}>нижнее</Text>
      </View>
    </View>
  );
}

const STAGE_ROW: Record<Exclude<SleepStage, 'awake'>, number> = { deep: 0, light: 1 };
const STAGE_NAME = { deep: 'Глубокий', light: 'Лёгкий' } as const;

/** Гипнограмма из двух строк, ступенчатая. */
export function Hypnogram({ segments, width }: { segments: DaySnapshot['sleepSegments']; width: number }) {
  const real = segments.filter((s) => s.stage !== 'awake');
  if (!real.length) return empty(width, 'Сна за эту ночь нет');
  const from = Math.min(...real.map((s) => s.from));
  const to = Math.max(...real.map((s) => s.to));
  const gutter = 66;
  const rowHeight = 26;
  const height = rowHeight * 2 + 34;
  const x = (m: number) => gutter + ((m - from) / Math.max(1, to - from)) * (width - gutter);
  const y = (row: number) => 10 + row * rowHeight;

  return (
    <View pointerEvents="none">
      <Svg width={width} height={height}>
        {(['deep', 'light'] as const).map((stage) => (
          <SvgText key={stage} x={gutter - 8} y={y(STAGE_ROW[stage]) + rowHeight / 2 + 4} fill={colors.textMuted} fontSize={12} textAnchor="end">
            {STAGE_NAME[stage]}
          </SvgText>
        ))}
        {real.map((seg, i) => {
          const stage = seg.stage as Exclude<SleepStage, 'awake'>;
          return (
            <Rect
              key={i}
              x={x(seg.from)}
              y={y(STAGE_ROW[stage]) + 5}
              width={Math.max(1.5, x(seg.to) - x(seg.from))}
              height={rowHeight - 10}
              rx={3}
              fill={stage === 'deep' ? colors.accent : withAlpha(colors.accent, 0.4)}
            />
          );
        })}
      </Svg>
      <View style={styles.edges}>
        <Text style={styles.edge}>{formatMinute(from)}</Text>
        <Text style={styles.edge}>{formatMinute(to)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 14 },
  touch: { color: colors.text, fontSize: 14, textAlign: 'center', marginTop: spacing.xs },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs, paddingLeft: Y_GUTTER },
  swatch: { width: 14, height: 2, borderRadius: 1 },
  legendText: { color: colors.textFaint, fontSize: 12, marginRight: spacing.sm },
  edges: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, paddingLeft: 66 },
  edge: { color: colors.textMuted, fontSize: 13 },
});
