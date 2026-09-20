import { useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
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

/** Пульс и шаги по часам на одном поле: линия сверху, слабые столбики под ней. */
export function DayActivityChart({
  heart,
  hours,
  width,
  age,
}: {
  heart: DayPoint[];
  hours: number[];
  width: number;
  age: number | null;
}) {
  const [touch, setTouch] = useState<{ m: number; hr: number | null; steps: number } | null>(null);
  const [zone, setZone] = useState<{ from: number; to: number; peak: number } | null>(null);
  const loads = loadIntervals(heart.map((p) => ({ m: p.m, v: p.v })), age);
  const smooth = smoothHeart(heart.map((p) => ({ ts: p.m * 60, value: p.v })));
  const hrValues = smooth.map((s) => s.value);
  if (!smooth.length && hours.every((v) => v === 0)) return empty(width);

  const hrMin = hrValues.length ? Math.min(...hrValues) - 5 : 40;
  const hrMax = hrValues.length ? Math.max(...hrValues) + 5 : 120;
  const stepsMax = Math.max(...hours, 1);
  const x = (minute: number) => GUTTER + (minute / 1440) * (width - GUTTER * 2);
  const yHr = (v: number) => 12 + (1 - (v - hrMin) / Math.max(1, hrMax - hrMin)) * (HEIGHT - 52);
  const yStep = (v: number) => HEIGHT - 18 - (v / stepsMax) * (HEIGHT * 0.32);
  const barWidth = (width - GUTTER * 2) / 24;
  const segments = splitSegments(smooth, HR_SMOOTH_MAX_GAP);

  const pick = (e: GestureResponderEvent) => {
    const minute = Math.max(0, Math.min(1439, ((e.nativeEvent.locationX - GUTTER) / (width - GUTTER * 2)) * 1440));
    const nearest = smooth.length
      ? smooth.reduce((a, b) => (Math.abs(b.ts / 60 - minute) < Math.abs(a.ts / 60 - minute) ? b : a))
      : null;
    setTouch({ m: minute, hr: nearest ? nearest.value : null, steps: hours[Math.floor(minute / 60)] ?? 0 });
    setZone(loads.find((z) => minute >= z.from - 15 && minute <= z.to + 15) ?? null);
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => {
        setTouch(null);
        setZone(null);
      }}
    >
      <Svg width={width} height={HEIGHT}>
        {loads.map((z, i) => (
          <Rect
            key={`z${i}`}
            x={x(z.from)}
            y={8}
            width={Math.max(3, x(z.to) - x(z.from))}
            height={HEIGHT - 26}
            fill={withAlpha(colors.accent, 0.1)}
            rx={4}
          />
        ))}
        {hours.map((value, hour) =>
          value > 0 ? (
            <Rect
              key={hour}
              x={x(hour * 60 + 30) - barWidth / 2}
              y={yStep(value)}
              width={barWidth}
              height={Math.max(2, HEIGHT - 18 - yStep(value))}
              rx={2}
              fill={withAlpha(colors.accent, 0.22)}
            />
          ) : null,
        )}
        {segments.map((seg, i) =>
          seg.length === 1 ? (
            <Circle key={i} cx={x(seg[0].ts / 60)} cy={yHr(seg[0].value)} r={4} fill={colors.accent} />
          ) : (
            <Path
              key={i}
              d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.ts / 60)} ${yHr(p.value)}`).join(' ')}
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ),
        )}
        {touch ? <Line x1={x(touch.m)} x2={x(touch.m)} y1={8} y2={HEIGHT - 18} stroke={colors.textFaint} strokeWidth={1} /> : null}
        {[0, 360, 720, 1080, 1440].map((m) => (
          <SvgText key={m} x={x(m)} y={HEIGHT - 2} fill={colors.textFaint} fontSize={11} textAnchor={m === 0 ? 'start' : m === 1440 ? 'end' : 'middle'}>
            {formatMinute(m)}
          </SvgText>
        ))}
      </Svg>
      {zone ? (
        <Text style={styles.touch}>
          {formatMinute(zone.from)}–{formatMinute(zone.to)} · до {Math.round(zone.peak)} уд/мин ·{' '}
          {Math.max(1, Math.round(zone.to - zone.from))} мин
        </Text>
      ) : touch ? (
        <Text style={styles.touch}>
          {formatMinute(touch.m)}
          {touch.hr !== null ? ` · ${Math.round(touch.hr)} уд/мин` : ''}
          {touch.steps > 0 ? ` · ${touch.steps} шагов` : ''}
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
