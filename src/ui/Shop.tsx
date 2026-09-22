import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatCount } from '../domain';
import { NutGlyph } from './RewardIcons';
import { Sheet } from './Sheet';
import { colors, radius, spacing } from './theme';

export const SHOP_TITLE = 'Магазин';
export const SHOP_EMPTY_TEXT = 'Скоро здесь появятся предметы';

/**
 * Баланс орехов под датой на «Сегодня». Нажатие открывает «Магазин» — пока пустой:
 * заголовок и заглушка, тратить орехи нечем.
 */
export function NutsBalance({ nuts }: { nuts: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        style={styles.balance}
        hitSlop={8}
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen(true);
        }}
        accessibilityLabel={`Орехи: ${nuts}. Открыть магазин`}
      >
        <NutGlyph size={15} />
        <Text style={styles.balanceText}>{formatCount(nuts)}</Text>
      </Pressable>
      <Sheet visible={open} title={SHOP_TITLE} onClose={() => setOpen(false)}>
        <View style={styles.empty}>
          <NutGlyph size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>{SHOP_EMPTY_TEXT}</Text>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  balanceText: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emptyText: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
});
