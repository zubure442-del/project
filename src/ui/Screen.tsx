import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarButton } from './Calendar';
import { InfoButton } from './Sheet';
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
  /** Один «i» в шапке: описание метрик вкладки простыми словами. На «Сегодня» его нет. */
  info?: { title: string; text: string };
  statusText: string;
  /** Обновление: открывает экран загрузки (или «Данные актуальны», если кэш свежий). */
  onSync: () => void;
  /** Плашка над содержимым: например, о незаполненной биометрии. */
  banner?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, info, statusText, onSync, banner, children }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <Text style={styles.title}>{title}</Text>
            {info ? <InfoButton title={info.title} text={info.text} /> : null}
          </View>
          {/* Календарь: выбранный день один на все вкладки. */}
          <CalendarButton />
        </View>
        <Pressable style={styles.statusRow} onPress={onSync}>
          <Text style={styles.status}>
            {statusText}
          </Text>
        </Pressable>
      </View>
      {banner}

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onSync} tintColor={colors.textMuted} />}
      >
        {children}
      </ScrollView>
    </View>
  );
}

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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  title: { color: colors.text, fontSize: 28, fontWeight: '600', flexShrink: 1 },
  spacer: { flex: 1 },
  statusRow: { marginTop: 4, height: 20, justifyContent: 'center' },
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
