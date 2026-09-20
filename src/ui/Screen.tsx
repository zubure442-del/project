import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from './Logo';
import { GearIcon } from './TabIcons';
import { colors, radius, spacing } from './theme';

export interface ScreenProps {
  title: string;
  /** «Синхронизировано 5 мин назад» или почему этого ещё не было. */
  statusText: string;
  busy: boolean;
  progress: string | null;
  demo: boolean;
  onSync: () => void;
  onForgetDemo: () => void;
  onOpenSettings?: () => void;
  children: ReactNode;
}

/** Общий каркас вкладки: шапка с кнопкой синхронизации, строка статуса, обновление свайпом. */
export function Screen({ title, statusText, busy, progress, demo, onSync, onForgetDemo, onOpenSettings, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Logo size={26} />
          <Text style={styles.title}>{title}</Text>
          <View style={styles.spacer} />
          <Pressable style={[styles.syncButton, busy && styles.syncBusy]} onPress={onSync} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={colors.bg} /> : <Text style={styles.syncText}>Обновить</Text>}
          </Pressable>
          {onOpenSettings ? (
            <Pressable style={styles.gear} onPress={onOpenSettings} hitSlop={8}>
              <GearIcon color={colors.textMuted} size={22} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.status}>{progress ?? statusText}</Text>
          {demo ? (
            <Pressable onPress={onForgetDemo} hitSlop={8}>
              <Text style={styles.demo}>убрать</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={onSync} tintColor={colors.accent} />}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** Карточка с заголовком. */
export function Card({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? (
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {note ? <Text style={styles.cardNote}>{note}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: 21, fontWeight: '500' },
  spacer: { flex: 1 },
  syncButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, minWidth: 56, alignItems: 'center' },
  gear: { padding: 4 },
  syncBusy: { opacity: 0.5 },
  syncText: { color: colors.bg, fontSize: 13, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  status: { color: colors.textMuted, fontSize: 13 },
  demo: { color: colors.accent, fontSize: 13 },
  scroll: { flex: 1 },

  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.card,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  cardTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  cardNote: { color: colors.textMuted, fontSize: 12.5, flexShrink: 1 },

  stat: { width: '50%', marginBottom: spacing.md },
  statLabel: { color: colors.textMuted, fontSize: 13, marginBottom: 3 },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '200' },
  statUnit: { color: colors.textMuted, fontSize: 13, fontWeight: '400' },
  statRow: { flexDirection: 'row', flexWrap: 'wrap' },
  disclaimer: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
});
