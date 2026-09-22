import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, radius, spacing, withAlpha } from './theme';

export interface SparkPoint {
  /** Минута от полуночи. */
  m: number;
  v: number;
}

/** Высота миниатюрного графика в плитке. */
export const SPARK_HEIGHT = 40;
const PAD = 3;

const line = (points: readonly SparkPoint[], width: number, height: number, min: number, span: number): string => {
  const first = points[0].m;
  const last = points[points.length - 1].m;
  const range = Math.max(1, last - first);
  const x = (m: number) => PAD + ((m - first) / range) * (width - PAD * 2);
  const y = (v: number) => height - PAD - ((v - min) / span) * (height - PAD * 2);
  return points.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
};

/**
 * Миниатюрный график без осей и подписей: только форма дня и точка на последнем замере.
 * Вторая линия (`second`) нужна давлению: верхнее и нижнее рядом.
 */
export function Sparkline({
  points,
  second,
  width,
  height = SPARK_HEIGHT,
}: {
  points: readonly SparkPoint[];
  second?: readonly SparkPoint[];
  width: number;
  height?: number;
}) {
  if (points.length < 2) return <View style={{ width, height }} />;
  const all = [...points, ...(second ?? [])].map((p) => p.v);
  const min = Math.min(...all);
  const span = Math.max(1, Math.max(...all) - min);
  const last = points[points.length - 1];
  const first = points[0].m;
  const range = Math.max(1, last.m - first);
  const lastX = PAD + ((last.m - first) / range) * (width - PAD * 2);
  const lastY = height - PAD - ((last.v - min) / span) * (height - PAD * 2);

  return (
    <View pointerEvents="none">
      <Svg width={width} height={height}>
        {second && second.length > 1 ? (
          <Path
            d={line(second, width, height, min, span)}
            stroke={withAlpha(colors.accent, 0.4)}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
        <Path
          d={line(points, width, height, min, span)}
          stroke={colors.accent}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Circle cx={lastX} cy={lastY} r={2.6} fill={colors.accent} />
      </Svg>
    </View>
  );
}

/**
 * Плитка «Организма»: название, миниатюрный график за день и текущее значение.
 * Плитки стоят по две в ряд — весь раздел виден одним экраном, без длинных графиков.
 */
export function SparkTile({
  title,
  value,
  unit,
  points,
  second,
  width,
}: {
  title: string;
  value: string;
  unit?: string;
  points: readonly SparkPoint[];
  second?: readonly SparkPoint[];
  width: number;
}) {
  return (
    <View style={[styles.tile, { width }]}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Sparkline points={points} second={second} width={width - spacing.md * 2} />
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.xs },
  title: { color: colors.textMuted, fontSize: 13 },
  value: { color: colors.text, fontSize: 24, fontWeight: '300', fontVariant: ['tabular-nums'] },
  unit: { color: colors.textMuted, fontSize: 13, fontWeight: '400' },
});
