import React, { useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { HR_SMOOTH_MAX_GAP, formatMinute, loadIntervals, smoothHeart, splitSegments, type SleepStage } from '../domain';
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

/** Минимальная ширина прямоугольника нагрузки, чтобы короткий эпизод был заметен. */
const MIN_ZONE_WIDTH = 6;
/** Запас по вертикали вокруг пульса эпизода. */
const ZONE_PADDING = 0.15;
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
  const [picked, setPicked] = useState<LoadZone | null>(null);
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
  const y = (v: number) => 10 + (1 - (v - yMin) / (yMax - yMin)) * (HEIGHT - 32);
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax; t += PULSE_STEP) ticks.push(t);
  const segments = splitSegments(smooth, HR_SMOOTH_MAX_GAP);

  const pick = (e: GestureResponderEvent) => {
    const minute = ((e.nativeEvent.locationX - gutter) / plot) * 1440;
    setPicked(zones.find((z) => minute >= z.from - 10 && minute <= z.to + 10) ?? null);
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => setPicked(null)}
    >
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

        {zones.map((z, i) => {
          // Если внутри эпизода замеров пульса нет, рисуем среднюю полосу графика.
          const hasPulse = z.peak !== null && z.low !== null;
          const span = hasPulse ? Math.max(1, (z.peak as number) - (z.low as number)) : 0;
          const top = hasPulse
            ? y(Math.min(yMax, (z.peak as number) + span * ZONE_PADDING))
            : 10 + (HEIGHT - 32) * 0.35;
          const bottom = hasPulse
            ? y(Math.max(yMin, (z.low as number) - span * ZONE_PADDING))
            : 10 + (HEIGHT - 32) * 0.65;
          const left = x(z.from);
          const zoneWidth = Math.max(MIN_ZONE_WIDTH, x(z.to) - left);
          return (
            <Rect
              key={i}
              x={left}
              y={top}
              width={zoneWidth}
              height={Math.max(8, bottom - top)}
              fill="url(#load-hatch)"
              stroke={colors.accent}
              strokeWidth={1}
              strokeOpacity={0.6}
              rx={2}
            />
          );
        })}

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
      {picked ? (
        <Text style={styles.touch}>
          {formatMinute(picked.from)}–{formatMinute(picked.to)} · {Math.round(picked.to - picked.from)} мин
          {picked.steps > 0 ? ` · ${picked.steps.toLocaleString('ru-RU')} шагов` : ''}
          {picked.peak !== null ? ` · до ${Math.round(picked.peak)} уд/мин` : ''}
        </Text>
      ) : null}
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

/** Общий график одного показателя за день: линия с разрывами и значение по нажатию. */
export function DayLineChart({
  points,
  width,
  yMin,
  yMax,
  maxGap,
  guides = [],
  format = (v: number) => String(Math.round(v)),
}: {
  points: DayPoint[];
  width: number;
  yMin?: number;
  yMax?: number;
  maxGap?: number;
  guides?: number[];
  format?: (v: number) => string;
}) {
  const [touch, setTouch] = useState<{ m: number; v: number } | null>(null);
  const sorted = [...points].sort((a, b) => a.m - b.m);
  if (!sorted.length) return empty(width);

  const values = sorted.map((p) => p.v);
  const lo = yMin ?? Math.min(...values) - 2;
  const hi = yMax ?? Math.max(...values) + 2;
  const x = (m: number) => GUTTER + (m / 1440) * (width - GUTTER * 2);
  const y = (v: number) => 12 + (1 - (v - lo) / Math.max(1, hi - lo)) * (HEIGHT - 44);
  const segments = splitSegments(sorted.map((p) => ({ ts: p.m * 60, value: p.v })), maxGap ?? gapFor(sorted));

  const pick = (e: GestureResponderEvent) => {
    const minute = ((e.nativeEvent.locationX - GUTTER) / (width - GUTTER * 2)) * 1440;
    const nearest = sorted.reduce((a, b) => (Math.abs(b.m - minute) < Math.abs(a.m - minute) ? b : a));
    setTouch({ m: nearest.m, v: nearest.v });
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => setTouch(null)}
    >
      <Svg width={width} height={HEIGHT}>
        {guides.map((g) => (
          <Line key={g} x1={0} x2={width} y1={y(g)} y2={y(g)} stroke={colors.track} strokeWidth={1} />
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
              strokeLinejoin="round"
              fill="none"
            />
          ),
        )}
        {touch ? <Circle cx={x(touch.m)} cy={y(touch.v)} r={5} fill={colors.arcTo} /> : null}
        {[0, 720, 1440].map((m) => (
          <SvgText key={m} x={x(m)} y={HEIGHT - 2} fill={colors.textFaint} fontSize={11} textAnchor={m === 0 ? 'start' : m === 1440 ? 'end' : 'middle'}>
            {formatMinute(m)}
          </SvgText>
        ))}
      </Svg>
      {touch ? (
        <Text style={styles.touch}>
          {format(touch.v)} · {formatMinute(touch.m)}
        </Text>
      ) : null}
    </View>
  );
}

/** Давление: две линии, верхнее и нижнее. */
export function PressureChart({ points, width }: { points: { m: number; sys: number; dia: number }[]; width: number }) {
  const sorted = [...points].sort((a, b) => a.m - b.m);
  if (!sorted.length) return empty(width);
  const all = sorted.flatMap((p) => [p.sys, p.dia]);
  const lo = Math.min(...all) - 6;
  const hi = Math.max(...all) + 6;
  const x = (m: number) => GUTTER + (m / 1440) * (width - GUTTER * 2);
  const y = (v: number) => 12 + (1 - (v - lo) / Math.max(1, hi - lo)) * (HEIGHT - 44);
  const line = (key: 'sys' | 'dia', color: string) =>
    splitSegments(
      sorted.map((p) => ({ ts: p.m * 60, value: p[key] })),
      gapFor(sorted.map((p) => ({ m: p.m, v: p.sys }))),
    ).map((seg, i) =>
      seg.length === 1 ? (
        <Circle key={`${key}${i}`} cx={x(seg[0].ts / 60)} cy={y(seg[0].value)} r={4} fill={color} />
      ) : (
        <Path
          key={`${key}${i}`}
          d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.ts / 60)} ${y(p.value)}`).join(' ')}
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          fill="none"
        />
      ),
    );
  return (
    <Svg width={width} height={HEIGHT}>
      {line('sys', colors.accent)}
      {line('dia', withAlpha(colors.accent, 0.45))}
      {[0, 720, 1440].map((m) => (
        <SvgText key={m} x={x(m)} y={HEIGHT - 2} fill={colors.textFaint} fontSize={11} textAnchor={m === 0 ? 'start' : m === 1440 ? 'end' : 'middle'}>
          {formatMinute(m)}
        </SvgText>
      ))}
    </Svg>
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
    <View>
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
  edges: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, paddingLeft: 66 },
  edge: { color: colors.textMuted, fontSize: 13 },
});
