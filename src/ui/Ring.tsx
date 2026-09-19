import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from './theme';

interface RingProps {
  /** 0–100 или null («недостаточно данных» — дуга не рисуется). */
  value: number | null;
  size: number;
  thickness: number;
  color?: string;
  children?: ReactNode;
}

/** Кольцевой индикатор: дорожка + дуга от 12 часов по часовой стрелке. */
export function Ring({ value, size, thickness, color = colors.accent, children }: RingProps) {
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={thickness} fill="none" />
        {filled > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
            fill="none"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <View style={styles.center} pointerEvents="none">{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
