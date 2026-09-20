import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DaySnapshot } from '../storage';
import { colors, radius, spacing, withAlpha } from './theme';

const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dayLabel = (date: string) => WEEK_DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

export interface WeekMetric {
  id: string;
  label: string;
  /** Крупное число. null — данных за день нет. */
  value: (day: DaySnapshot) => number | null;
  /** Мелкая строка под числом. */
  caption?: (day: DaySnapshot) => string | null;
  format?: (value: number) => string;
}

interface WeekStripProps {
  days: { date: string; day: DaySnapshot | null }[];
  metrics: WeekMetric[];
  metricId: string;
  onMetric: (id: string) => void;
  selected: string;
  onSelect: (date: string) => void;
}

/** Полоса из семи дней вверху каждого раздела. Нажатие переключает весь экран на этот день. */
export function WeekStrip({ days, metrics, metricId, onMetric, selected, onSelect }: WeekStripProps) {
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const format = metric.format ?? ((v: number) => String(Math.round(v)));

  return (
    <View style={styles.root}>
      {metrics.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.switcher}>
          {metrics.map((m) => (
            <Pressable key={m.id} onPress={() => onMetric(m.id)} style={[styles.tab, m.id === metric.id && styles.tabOn]}>
              <Text style={[styles.tabText, m.id === metric.id && styles.tabTextOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.week}>
        {days.map(({ date, day }) => {
          const value = day ? metric.value(day) : null;
          const caption = day ? (metric.caption?.(day) ?? null) : null;
          const isSelected = date === selected;
          return (
            <Pressable key={date} onPress={() => onSelect(date)} style={[styles.day, isSelected && styles.dayOn]}>
              <Text style={[styles.name, isSelected && styles.nameOn]}>{dayLabel(date)}</Text>
              <Text style={[styles.value, value === null && styles.valueEmpty, isSelected && styles.valueOn]}>
                {value === null ? '—' : format(value)}
              </Text>
              <Text style={styles.caption} numberOfLines={1}>
                {caption ?? ' '}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: spacing.md },
  switcher: { gap: spacing.xs, paddingBottom: spacing.sm },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.card },
  tabOn: { backgroundColor: withAlpha(colors.accent, 0.18) },
  tabText: { color: colors.textMuted, fontSize: 13 },
  tabTextOn: { color: colors.accent },

  week: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.card, gap: 2 },
  dayOn: { backgroundColor: colors.card },
  name: { color: colors.textFaint, fontSize: 12 },
  nameOn: { color: colors.textMuted },
  value: { color: colors.text, fontSize: 17, fontWeight: '500' },
  valueOn: { color: colors.accent },
  valueEmpty: { color: colors.textFaint, fontWeight: '400' },
  caption: { color: colors.textFaint, fontSize: 11 },
});
