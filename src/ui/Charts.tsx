import React, { useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import {
  HR_SMOOTH_MAX_GAP,
  STRESS_ZONE_BOUNDS,
  formatMinute,
  niceTicks,
  smoothHeart,
  splitSegments,
  type SleepStage,
} from '../domain';
import type { DayPoint, DaySnapshot } from '../storage';
import { Plot } from './Plot';
import { colors, spacing, withAlpha } from './theme';

/** Стресс: разрыв больше 45 минут линией не затягиваем. */
export const STRESS_MAX_GAP = 45 * 60;

/** Пульс: только сглаженная линия. Точное значение — при удержании пальца. */
export function HeartChart({ points, width }: { points: DayPoint[]; width: number }) {
  const [touch, setTouch] = useState<{ x: number; m: number; v: number } | null>(null);
  const smooth = smoothHeart(points.map((p) => ({ ts: p.m * 60, value: p.v })));
  const values = smooth.map((s) => s.value);
  const yMin = values.length ? Math.min(...values) - 5 : 40;
  const yMax = values.length ? Math.max(...values) + 5 : 120;
  const segments = splitSegments(smooth, HR_SMOOTH_MAX_GAP);
  const gutter = 36;

  const pick = (e: GestureResponderEvent) => {
    if (!smooth.length) return;
    const x = e.nativeEvent.locationX;
    const minute = ((x - gutter) / Math.max(1, width - gutter)) * 1440;
    const nearest = smooth.reduce((a, b) =>
      Math.abs(b.ts / 60 - minute) < Math.abs(a.ts / 60 - minute) ? b : a,
    );
    setTouch({ x, m: nearest.ts / 60, v: nearest.value });
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => setTouch(null)}
    >
      <Plot width={width} yMin={yMin} yMax={yMax} yTicks={niceTicks(yMin, yMax, 4)} empty={points.length < 2}>
        {(s) => (
          <>
            {segments.map((seg, i) =>
              seg.length === 1 ? (
                <Circle key={i} cx={s.x(seg[0].ts / 60)} cy={s.y(seg[0].value)} r={3} fill={colors.accent} />
              ) : (
                <Path
                  key={i}
                  d={seg.map((p, j) => `${j ? 'L' : 'M'}${s.x(p.ts / 60)} ${s.y(p.value)}`).join(' ')}
                  stroke={colors.accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ),
            )}
            {touch ? (
              <>
                <Line x1={s.x(touch.m)} x2={s.x(touch.m)} y1={s.top} y2={s.bottom} stroke={colors.textFaint} strokeWidth={1} />
                <Circle cx={s.x(touch.m)} cy={s.y(touch.v)} r={4} fill={colors.arcTo} />
              </>
            ) : null}
          </>
        )}
      </Plot>
      {touch ? (
        <Text style={styles.touch}>
          {Math.round(touch.v)} уд/мин · {formatMinute(touch.m)}
        </Text>
      ) : null}
    </View>
  );
}

/** Стресс за день: линия 0–100 с границами зон. */
export function StressChart({ points, width }: { points: DayPoint[]; width: number }) {
  const sorted = [...points].sort((a, b) => a.m - b.m);
  const segments = splitSegments(sorted.map((p) => ({ ts: p.m * 60, value: p.v })), STRESS_MAX_GAP);
  return (
    <Plot width={width} yMin={0} yMax={100} yTicks={[0, ...STRESS_ZONE_BOUNDS, 100]} empty={!sorted.length}>
      {(s) => (
        <>
          {segments.map((seg, i) =>
            seg.length === 1 ? (
              <Circle key={i} cx={s.x(seg[0].ts / 60)} cy={s.y(seg[0].value)} r={3} fill={colors.accent} />
            ) : (
              <Path
                key={i}
                d={seg.map((p, j) => `${j ? 'L' : 'M'}${s.x(p.ts / 60)} ${s.y(p.value)}`).join(' ')}
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                fill="none"
              />
            ),
          )}
        </>
      )}
    </Plot>
  );
}

/** Шаги по часам: 24 столбца. */
export function StepsHourChart({ hours, width }: { hours: number[]; width: number }) {
  const max = Math.max(...hours, 1);
  const barWidth = Math.max(4, (width - 36) / 24 - 3);
  return (
    <Plot width={width} yMin={0} yMax={max} yTicks={niceTicks(0, max, 3)} empty={hours.every((v) => v === 0)}>
      {(s) => (
        <>
          <Defs>
            <LinearGradient id="steps-bar" x1="0.5" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor={colors.arcTo} />
              <Stop offset="1" stopColor={colors.arcFrom} />
            </LinearGradient>
          </Defs>
          {hours.map((value, hour) =>
            value > 0 ? (
              <Rect
                key={hour}
                x={s.x(hour * 60 + 30) - barWidth / 2}
                y={s.y(value)}
                width={barWidth}
                height={Math.max(2, s.bottom - s.y(value))}
                rx={2}
                fill="url(#steps-bar)"
              />
            ) : null,
          )}
        </>
      )}
    </Plot>
  );
}

const STAGE_COLOR: Record<SleepStage, string> = {
  deep: colors.accent,
  light: withAlpha(colors.accent, 0.4),
  awake: 'transparent',
};

/** Сон: одна полоса времени в двух тонах, по краям — время засыпания и подъёма. */
export function SleepBar({ segments, width }: { segments: DaySnapshot['sleepSegments']; width: number }) {
  if (!segments.length) {
    return (
      <View style={[styles.empty, { width }]}>
        <Text style={styles.emptyText}>Сна за эту ночь нет</Text>
      </View>
    );
  }
  const from = Math.min(...segments.map((s) => s.from));
  const to = Math.max(...segments.map((s) => s.to));
  const span = Math.max(1, to - from);
  const height = 14;
  const x = (minute: number) => ((minute - from) / span) * width;

  return (
    <View>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} rx={height / 2} fill={colors.track} />
        {segments.map((seg, i) =>
          seg.stage === 'awake' ? null : (
            <Rect
              key={i}
              x={x(seg.from)}
              y={0}
              width={Math.max(1.5, x(seg.to) - x(seg.from))}
              height={height}
              fill={STAGE_COLOR[seg.stage]}
            />
          ),
        )}
      </Svg>
      <View style={styles.edges}>
        <Text style={styles.edge}>{formatMinute(from)}</Text>
        <Text style={styles.edge}>{formatMinute(to)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { height: 56, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 14 },
  touch: { color: colors.text, fontSize: 14, textAlign: 'center', marginTop: spacing.xs },
  edges: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  edge: { color: colors.textMuted, fontSize: 13 },
});
