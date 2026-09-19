import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';

interface RingProps {
  /** 0–100 или null («недостаточно данных» — дуга не рисуется). */
  value: number | null;
  size: number;
  thickness: number;
  /** Свечение на конце дуги — только у главного кольца, чтобы оно читалось как главное. */
  glow?: boolean;
  children?: ReactNode;
}

/** Кольцевой индикатор: дорожка, дуга с тёплым градиентом от 12 часов по часовой и огонёк на конце. */
export function Ring({ value, size, thickness, glow = false, children }: RingProps) {
  const uid = useId();
  const arcId = `arc-${uid}`;
  const glowId = `glow-${uid}`;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;

  const tipAngle = (-90 + 360 * filled) * (Math.PI / 180);
  const tipX = cx + r * Math.cos(tipAngle);
  const tipY = cx + r * Math.sin(tipAngle);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={arcId} x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor={colors.arcFrom} />
            <Stop offset="1" stopColor={colors.arcTo} />
          </LinearGradient>
          <RadialGradient id={glowId}>
            <Stop offset="0" stopColor={colors.arcTo} stopOpacity={0.55} />
            <Stop offset="0.45" stopColor={colors.arcTo} stopOpacity={0.16} />
            <Stop offset="1" stopColor={colors.arcTo} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cx} r={r} stroke={colors.track} strokeWidth={thickness} fill="none" />
        {filled > 0 && (
          <>
            <Circle
              cx={cx}
              cy={cx}
              r={r}
              stroke={`url(#${arcId})`}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${circumference * filled} ${circumference}`}
              fill="none"
              transform={`rotate(-90 ${cx} ${cx})`}
            />
            {glow && (
              <>
                <Circle cx={tipX} cy={tipY} r={thickness * 2.6} fill={`url(#${glowId})`} />
                <Circle cx={tipX} cy={tipY} r={thickness * 0.3} fill="#FFF6E4" />
              </>
            )}
          </>
        )}
      </Svg>
      <View style={styles.center} pointerEvents="none">{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
