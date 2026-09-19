import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { smoothHeart, splitSegments, HR_SMOOTH_MAX_GAP } from '../domain';
import type { DayPoint } from '../storage';
import { colors, spacing, withAlpha } from './theme';

const HEIGHT = 130;
const DAY_MINUTES = 1440;
/** Подписи оси: 0, 6, 12, 18, 24 часа. */
const HOUR_TICKS = [0, 6, 12, 18, 24];

interface Scale {
  x: (minute: number) => number;
  y: (value: number) => number;
}

function makeScale(width: number, min: number, max: number): Scale {
  const span = max - min || 1;
  return {
    x: (minute) => (minute / DAY_MINUTES) * width,
    y: (value) => HEIGHT - 18 - ((value - min) / span) * (HEIGHT - 32),
  };
}

function Axis({ width }: { width: number }) {
  return (
    <>
      {HOUR_TICKS.map((h) => (
        <Line
          key={h}
          x1={(h / 24) * width}
          x2={(h / 24) * width}
          y1={6}
          y2={HEIGHT - 18}
          stroke={colors.track}
          strokeWidth={1}
        />
      ))}
    </>
  );
}

function HourLabels({ width }: { width: number }) {
  return (
    <View style={styles.labels}>
      {HOUR_TICKS.slice(0, 4).map((h) => (
        <Text key={h} style={[styles.label, { left: (h / 24) * width + 2 }]}>{h}:00</Text>
      ))}
    </View>
  );
}

/** Пульс: бледные точки — сами замеры, яркая линия — скользящая медиана ±45 мин, с разрывами. */
export function HeartChart({ points, width }: { points: DayPoint[]; width: number }) {
  if (points.length < 2) return <Empty width={width} />;
  const values = points.map((p) => p.v);
  const scale = makeScale(width, Math.min(...values) - 4, Math.max(...values) + 4);
  const asSamples = points.map((p) => ({ ts: p.m * 60, value: p.v }));
  const segments = splitSegments(smoothHeart(asSamples), HR_SMOOTH_MAX_GAP);

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        <Axis width={width} />
        {points.map((p, i) => (
          <Circle key={i} cx={scale.x(p.m)} cy={scale.y(p.v)} r={2.2} fill={withAlpha(colors.accent, 0.3)} />
        ))}
        {segments.map((seg, i) =>
          seg.length === 1 ? (
            <Circle key={i} cx={scale.x(seg[0].ts / 60)} cy={scale.y(seg[0].value)} r={3} fill={colors.accent} />
          ) : (
            <Path
              key={i}
              d={seg.map((s, j) => `${j ? 'L' : 'M'}${scale.x(s.ts / 60)} ${scale.y(s.value)}`).join(' ')}
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ),
        )}
      </Svg>
      <HourLabels width={width} />
    </View>
  );
}

/** SpO2: редкие одиночные замеры, линией не соединяем — между ними кольцо ничего не мерило. */
export function Spo2Chart({ points, width }: { points: DayPoint[]; width: number }) {
  if (!points.length) return <Empty width={width} />;
  const scale = makeScale(width, 92, 100);
  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        <Axis width={width} />
        {[95, 100].map((v) => (
          <Line key={v} x1={0} x2={width} y1={scale.y(v)} y2={scale.y(v)} stroke={colors.track} strokeWidth={1} />
        ))}
        {points.map((p, i) => (
          <Circle key={i} cx={scale.x(p.m)} cy={scale.y(p.v)} r={3.5} fill={colors.accent} />
        ))}
      </Svg>
      <HourLabels width={width} />
    </View>
  );
}

/** Неделя: столбики итога по дням. */
export function WeekBars({ days, width }: { days: { date: string; total: number | null }[]; width: number }) {
  const gap = 10;
  const barWidth = Math.max(8, (width - gap * (days.length - 1)) / days.length);
  const height = 110;
  return (
    <Svg width={width} height={height}>
      {days.map((d, i) => {
        const x = i * (barWidth + gap);
        const value = d.total ?? 0;
        const h = Math.max(3, (value / 100) * (height - 26));
        return (
          <Path
            key={d.date}
            d={`M${x} ${height - 22 - h} h${barWidth} v${h} h${-barWidth} Z`}
            fill={d.total === null ? colors.track : withAlpha(colors.accent, 0.35 + (value / 100) * 0.65)}
          />
        );
      })}
    </Svg>
  );
}

function Empty({ width }: { width: number }) {
  return (
    <View style={[styles.empty, { width, height: HEIGHT }]}>
      <Text style={styles.emptyText}>Недостаточно данных</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { height: 14, marginTop: -4 },
  label: { position: 'absolute', color: colors.textFaint, fontSize: 10 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 13 },
  spacer: { height: spacing.sm },
});
