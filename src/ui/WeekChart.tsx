import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { MAX_DAY_SPACING, MIN_DAYS_FOR_TREND, hasData, visibleDays } from '../domain';
import type { DaySnapshot } from '../storage';
import { colors, spacing, withAlpha } from './theme';

const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dayLabel = (date: string) => WEEK_DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

interface WeekChartProps {
  days: { date: string; day: DaySnapshot | null }[];
  value: (day: DaySnapshot) => number | null;
  selected: string;
  onSelect: (date: string) => void;
  width: number;
}

/** Компактный график за 7 дней. Числа только над выбранной точкой. */
export function WeekChart({ days, value, selected, onSelect, width }: WeekChartProps) {
  const [touched, setTouched] = useState(false);
  const height = 96;
  const top = 22;
  const bottom = height - 20;

  const shown = visibleDays(days);
  const points = shown.map(({ date, day }) => ({ date, v: hasData(day) ? value(day) : null }));
  const known = points.map((p) => p.v).filter((v): v is number => v !== null);
  const min = known.length ? Math.min(...known) : 0;
  const max = known.length ? Math.max(...known) : 100;
  const span = Math.max(1, max - min);
  // Ширина шага ограничена: два дня стоят по центру, семь занимают всю ширину.
  const step = Math.min(MAX_DAY_SPACING, width / Math.max(1, shown.length));
  const left = (width - step * shown.length) / 2;
  const x = (i: number) => left + step * (i + 0.5);
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top);

  // Линия рвётся на днях без данных: дорисовывать ноль было бы враньём.
  const segments: { i: number; v: number }[][] = [];
  points.forEach((p, i) => {
    if (p.v === null) {
      segments.push([]);
      return;
    }
    (segments[segments.length - 1] ??= segments[segments.push([]) - 1]).push({ i, v: p.v });
  });

  const selectedIndex = points.findIndex((p) => p.date === selected);
  const selectedValue = selectedIndex >= 0 ? points[selectedIndex].v : null;

  const pick = (e: GestureResponderEvent) => {
    const index = Math.max(0, Math.min(shown.length - 1, Math.floor((e.nativeEvent.locationX - left) / step)));
    const date = shown[index].date;
    if (date !== selected) {
      void Haptics.selectionAsync();
      onSelect(date);
    }
    setTouched(true);
  };

  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const trend =
    known.length >= MIN_DAYS_FOR_TREND && selectedValue !== null && average !== null
      ? Math.round(selectedValue - average)
      : null;

  if (!shown.length) return null;

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => setTouched(false)}
    >
      <Svg width={width} height={height}>
        {[top, bottom].map((gy) => (
          <Line key={gy} x1={0} x2={width} y1={gy} y2={gy} stroke={colors.track} strokeWidth={1} />
        ))}
        {segments
          .filter((seg) => seg.length > 1)
          .map((seg, k) => (
            <Path
              key={k}
              d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        {points.map((p, i) =>
          p.v === null ? null : (
            <Circle
              key={p.date}
              cx={x(i)}
              cy={y(p.v)}
              // Одиночный день рисуем крупнее, иначе его не видно.
              r={p.date === selected ? 5 : segments.some((s) => s.length === 1 && s[0].i === i) ? 4 : 3}
              fill={p.date === selected ? colors.arcTo : withAlpha(colors.accent, 0.75)}
            />
          ),
        )}
        {selectedValue !== null && selectedIndex >= 0 ? (
          <SvgText
            x={Math.min(width - 14, Math.max(14, x(selectedIndex)))}
            y={Math.max(14, y(selectedValue) - 12)}
            fill={colors.text}
            fontSize={14}
            textAnchor="middle"
          >
            {Math.round(selectedValue)}
          </SvgText>
        ) : null}
        {points.map((p, i) => (
          <SvgText
            key={`l${p.date}`}
            x={x(i)}
            y={height - 4}
            fill={p.date === selected ? colors.textMuted : colors.textFaint}
            fontSize={12}
            textAnchor="middle"
          >
            {dayLabel(p.date)}
          </SvgText>
        ))}
      </Svg>
      {trend !== null && !touched ? (
        <Text style={styles.trend}>
          {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} {Math.abs(trend)} к неделе
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trend: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
});
