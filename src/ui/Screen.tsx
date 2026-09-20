import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing } from './theme';

export interface ScreenProps {
  title: string;
  statusText: string;
  busy: boolean;
  progress: string | null;
  battery: number | null;
  onSync: () => void;
  onOpenRing: () => void;
  children: ReactNode;
}

/** Каркас вкладки: название, заряд, значок обновления. Основной способ обновить — потянуть вниз. */
export function Screen({ title, statusText, busy, progress, battery, onSync, onOpenRing, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.row}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.spacer} />
          <Pressable onPress={onOpenRing} hitSlop={10} style={styles.battery}>
            <Text style={styles.batteryText}>{battery === null ? '—' : `${battery} %`}</Text>
          </Pressable>
          <Pressable onPress={onSync} disabled={busy} hitSlop={10} style={styles.refresh}>
            {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <RefreshIcon />}
          </Pressable>
        </View>
        <Text style={styles.status}>{progress ?? statusText}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={onSync} tintColor={colors.textMuted} />}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function RefreshIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M20 12a8 8 0 1 1-2.6-5.9"
        stroke={colors.textMuted}
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M20 3.5V9h-5.5" stroke={colors.textMuted} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Карточка: одна мысль, без рамок и заголовков капслоком. */
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
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '600' },
  spacer: { flex: 1 },
  battery: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.card },
  batteryText: { color: colors.textMuted, fontSize: 13 },
  refresh: { padding: 2 },
  status: { color: colors.textFaint, fontSize: 13, marginTop: 4 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '500', flex: 1 },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { width: '50%' },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '300' },
  statUnit: { color: colors.textMuted, fontSize: 14 },
  statLabel: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
