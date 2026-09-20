import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Text as SvgText } from 'react-native-svg';
import { formatMinute } from '../domain';
import { colors } from './theme';

export const EMPTY_TEXT = 'Нет данных';

export interface Scale {
  /** Минуты от полуночи → координата X. */
  x(minute: number): number;
  y(value: number): number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PlotProps {
  width: number;
  height?: number;
  gutter?: number;
  /** Диапазон по времени в минутах. По умолчанию сутки. */
  xMin?: number;
  xMax?: number;
  xTicks?: number[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  yFormat?: (value: number) => string;
  empty?: boolean;
  children: (scale: Scale) => ReactNode;
}

/** Поле графика: сетка, подписи по обеим осям и пустое состояние. */
export function Plot({
  width,
  height = 150,
  gutter = 36,
  xMin = 0,
  xMax = 1440,
  xTicks,
  yMin,
  yMax,
  yTicks,
  yFormat = (v) => String(Math.round(v)),
  empty = false,
  children,
}: PlotProps) {
  if (empty) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>{EMPTY_TEXT}</Text>
      </View>
    );
  }
  const bottom = height - 20;
  const top = 10;
  const left = gutter;
  const right = width;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const scale: Scale = {
    x: (minute) => left + ((minute - xMin) / xSpan) * (right - left),
    y: (value) => bottom - ((value - yMin) / ySpan) * (bottom - top),
    left,
    right,
    top,
    bottom,
  };
  const timeTicks = xTicks ?? [0, 360, 720, 1080, 1440];
  const valueTicks = yTicks.map((value) => ({ value, label: yFormat(value) }));

  return (
    <Svg width={width} height={height}>
      {valueTicks.map((t) => (
        <Line
          key={`y${t.value}`}
          x1={left}
          x2={right}
          y1={scale.y(t.value)}
          y2={scale.y(t.value)}
          stroke={colors.track}
          strokeWidth={1}
        />
      ))}
      {timeTicks.map((m, i) => (
        <SvgText
          key={`xl${m}`}
          x={scale.x(m)}
          y={height - 4}
          fill={colors.textMuted}
          fontSize={11}
          // Крайние подписи прижимаем внутрь, иначе их срезает краем графика.
          textAnchor={i === 0 ? 'start' : i === timeTicks.length - 1 ? 'end' : 'middle'}
        >
          {formatMinute(m)}
        </SvgText>
      ))}
      {valueTicks.map((t) => (
        <SvgText key={`yl${t.value}`} x={left - 6} y={scale.y(t.value) + 4} fill={colors.textMuted} fontSize={11} textAnchor="end">
          {t.label}
        </SvgText>
      ))}
      {children(scale)}
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
