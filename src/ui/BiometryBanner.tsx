import { router } from 'expo-router';
import type { BannerKind } from '../state';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from './theme';

/** Красная плашка на всех вкладках, пока не заполнена биометрия. */
export function BiometryBanner() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Биометрия не настроена</Text>
      <Pressable onPress={() => router.push('/profile')} hitSlop={8}>
        <Text style={styles.action}>Настроить</Text>
      </Pressable>
    </View>
  );
}

/** Красная плашка, пока не выбрана цель (биометрия уже есть). */
export function GoalBanner() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Цель не выбрана</Text>
      <Pressable onPress={() => router.push('/profile')} hitSlop={8}>
        <Text style={styles.action}>Выбрать</Text>
      </Pressable>
    </View>
  );
}

/** Плашка «не всё загрузилось» с кнопкой повтора. */
export function IncompleteBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[styles.root, styles.neutral]}>
      <Text style={styles.neutralText}>Не все данные загружены</Text>
      <Pressable onPress={onRetry} hitSlop={8}>
        <Text style={styles.neutralAction}>Повторить</Text>
      </Pressable>
    </View>
  );
}

/** Одна плашка над экраном по приоритету: ошибка синхронизации, биометрия, цель. */
export function DayBanner({ kind, onRetry }: { kind: BannerKind | null; onRetry: () => void }) {
  if (kind === 'sync-failed') return <IncompleteBanner onRetry={onRetry} />;
  if (kind === 'biometry') return <BiometryBanner />;
  if (kind === 'goal') return <GoalBanner />;
  return null;
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: 'rgba(229, 112, 95, 0.16)',
  },
  text: { color: '#F0A398', fontSize: 14, flex: 1 },
  neutral: { backgroundColor: colors.card },
  neutralText: { color: colors.textMuted, fontSize: 14, flex: 1 },
  neutralAction: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  action: { color: '#F0A398', fontSize: 14, fontWeight: '600' },
});
