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

/** Серая плашка: сегодня ещё неполный, показан последний полный день. */
export function TodayLockedBanner({ phrase }: { phrase: string }) {
  return (
    <View style={[styles.root, styles.neutral]}>
      <Text style={styles.neutralText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        Ещё нет данных за сегодня · показан {phrase}
      </Text>
    </View>
  );
}

/** Одна плашка над экраном по приоритету: ошибка синхронизации, биометрия, неполный сегодня. */
export function DayBanner({ kind, phrase, onRetry }: { kind: BannerKind | null; phrase: string; onRetry: () => void }) {
  if (kind === 'sync-failed') return <IncompleteBanner onRetry={onRetry} />;
  if (kind === 'biometry') return <BiometryBanner />;
  if (kind === 'today-locked') return <TodayLockedBanner phrase={phrase} />;
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
