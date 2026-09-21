import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { SLEEP_LEVEL, formatMinute, sleepWave } from '../domain';
import type { DaySnapshot } from '../storage';
import { SLEEP_PALETTE, colors, spacing } from './theme';

const HEIGHT = 168;
const TOP = 26;
const BOTTOM = HEIGHT - 26;

/** Плавная лента ночи: глубокий сон внизу волны, лёгкий вверху. */
export interface WaveOverlay {
  /** Точки в минутах того же дня, что и отрезки сна. */
  points: { m: number; v: number }[];
  color: string;
}

export function SleepWave({
  segments,
  width,
  overlays = [],
}: {
  segments: DaySnapshot['sleepSegments'];
  width: number;
  /** Линии поверх волны (пульс, вариабельность во сне): каждая в своём масштабе. */
  overlays?: WaveOverlay[];
}) {
  const wave = sleepWave(segments);
  if (wave.length < 2) return null;

  const from = wave[0].m;
  const to = wave[wave.length - 1].m;
  const x = (m: number) => ((m - from) / Math.max(1, to - from)) * width;
  const y = (v: number) => TOP + ((v - SLEEP_LEVEL.light) / (SLEEP_LEVEL.deep - SLEEP_LEVEL.light)) * (BOTTOM - TOP);

  const line = wave.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${BOTTOM + 20} L0 ${BOTTOM + 20} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round((from + (to - from) * k) / 15) * 15);

  // График не нажимается и не перехватывает касания: иначе срабатывал при прокрутке.
  return (
    <View pointerEvents="none">
      <Svg width={width} height={HEIGHT}>
        <Defs>
          <LinearGradient id="sleep-area" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor={SLEEP_PALETTE.to} stopOpacity={0.45} />
            <Stop offset="1" stopColor={SLEEP_PALETTE.from} stopOpacity={0.05} />
          </LinearGradient>
          <LinearGradient id="sleep-line" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={SLEEP_PALETTE.from} />
            <Stop offset="1" stopColor={SLEEP_PALETTE.to} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#sleep-area)" />
        {/* Свечение линии: широкий полупрозрачный след под основной линией. */}
        <Path d={line} stroke={SLEEP_PALETTE.glow} strokeWidth={7} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
        <Path d={line} stroke="url(#sleep-line)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {overlays.map((o, k) => {
          const inside = o.points.filter((p) => p.m >= from && p.m <= to).sort((a, b) => a.m - b.m);
          if (inside.length < 2) return null;
          const lo = Math.min(...inside.map((p) => p.v));
          const hi = Math.max(...inside.map((p) => p.v));
          const oy = (v: number) => BOTTOM - ((v - lo) / Math.max(1, hi - lo)) * (BOTTOM - TOP);
          const d = inside.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)} ${oy(p.v).toFixed(1)}`).join(' ');
          return <Path key={k} d={d} stroke={o.color} strokeWidth={1.6} fill="none" strokeLinejoin="round" />;
        })}

        <SvgText x={2} y={TOP - 8} fill={colors.textFaint} fontSize={11} opacity={0.5}>
          Лёгкий
        </SvgText>
        <SvgText x={2} y={BOTTOM + 14} fill={colors.textFaint} fontSize={11} opacity={0.5}>
          Глубокий
        </SvgText>

        {ticks.map((m, i) => (
          <SvgText
            key={m}
            x={Math.min(width - 2, Math.max(2, x(m)))}
            y={HEIGHT - 2}
            fill={colors.textFaint}
            fontSize={11}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          >
            {formatMinute(m)}
          </SvgText>
        ))}
      </Svg>

      <View style={styles.edges}>
        <View style={styles.edge}>
          <MoonIcon />
          <Text style={styles.edgeText}>{formatMinute(from)}</Text>
        </View>
        <View style={styles.edge}>
          <SunIcon />
          <Text style={styles.edgeText}>{formatMinute(to)}</Text>
        </View>
      </View>

    </View>
  );
}

const MoonIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 24 24">
    <Path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill={SLEEP_PALETTE.glow} />
  </Svg>
);

const SunIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="4.4" fill={colors.accent} />
    <Path
      d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"
      stroke={colors.accent}
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </Svg>
);

const styles = StyleSheet.create({
  edges: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  edge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  edgeText: { color: colors.textMuted, fontSize: 13 },
  tip: { color: colors.text, fontSize: 14, textAlign: 'center', marginTop: spacing.xs },
});
