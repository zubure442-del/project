import { useEffect, useRef, type ReactNode } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ProgressArc } from './ProgressArc';
import { colors, radius, spacing } from './theme';

const WEEKDAY = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «Вс, 20 сентября» — дата выбранного дня под заголовком. */
export function formatDayTitle(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

export const weekdayName = (date: string) => WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

export interface ScreenProps {
  title: string;
  /** Дата выбранного дня. */
  date: string;
  statusText: string;
  /** Идёт фоновая догрузка. */
  loading: boolean;
  progress: number;
  packets: number;
  battery: number | null;
  onSync: () => void;
  onOpenRing: () => void;
  children: ReactNode;
}

export function Screen({
  title,
  date,
  statusText,
  loading,
  progress,
  packets,
  battery,
  onSync,
  onOpenRing,
  children,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const wasLoading = useRef(false);

  // Лёгкая отдача, когда догрузка закончилась.
  useEffect(() => {
    if (wasLoading.current && !loading) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    wasLoading.current = loading;
  }, [loading]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.row}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.spacer} />
          <Pressable onPress={onOpenRing} hitSlop={10} style={styles.battery}>
            <Text style={styles.batteryText}>{battery === null ? '—' : `${battery} %`}</Text>
          </Pressable>
        </View>
        <Text style={styles.date}>{formatDayTitle(date)}</Text>

        <Pressable style={styles.statusRow} onPress={onSync} disabled={loading}>
          {loading ? (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(300)} style={styles.row}>
              <ProgressArc size={22} progress={progress} pulse={packets} />
              <Text style={styles.status}>Загрузка · {Math.round(progress * 100)} %</Text>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn.duration(300)} style={styles.row}>
              <CheckIcon />
              <Text style={styles.status}>{statusText}</Text>
            </Animated.View>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onSync} tintColor={colors.textMuted} />}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const CheckIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 24 24">
    <Path d="M4 12.5 9.5 18 20 6.5" stroke={colors.textFaint} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title || right ? (
        <View style={styles.cardHead}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View style={styles.spacer} />}
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Серая заглушка формы блока, пока данных нет. */
export function Skeleton({ height, width }: { height: number; width?: number | `${number}%` }) {
  return <View style={[styles.skeleton, { height, width: width ?? '100%' }]} />;
}

export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: 28, fontWeight: '600' },
  date: { color: colors.textMuted, fontSize: 15, marginTop: 2 },
  spacer: { flex: 1 },
  battery: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.card },
  batteryText: { color: colors.textMuted, fontSize: 13 },
  statusRow: { marginTop: spacing.sm, height: 24, justifyContent: 'center' },
  status: { color: colors.textFaint, fontSize: 13, fontVariant: ['tabular-nums'] },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '500', flex: 1 },
  skeleton: { backgroundColor: colors.track, borderRadius: radius.card / 2 },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { width: '50%' },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '300' },
  statUnit: { color: colors.textMuted, fontSize: 14 },
  statLabel: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
