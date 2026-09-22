import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RelayView } from '../domain';
import { Mascot, mascotHeightFor } from './Mascot';
import { NutsPill, RELAY_TITLE, RelaySheet } from './Relay';
import { RelayGlyph } from './RewardIcons';
import { colors, radius, spacing, withAlpha } from './theme';

/** Высота фигуры: не больше этого и не шире доли экрана, чтобы рядом поместилось число. */
const MASCOT_MAX_HEIGHT = 230;
const MASCOT_WIDTH_SHARE = 0.55;

/**
 * Блок маскота на «Сегодня»: фигура, итог дня рядом (не поверх), баланс орехов
 * и строка «Эстафета от Лиса ›». Вся область — от ушей до ног вместе с числом — нажимается
 * и открывает лист с эстафетой, балансом и магазином. Строка внизу говорит, куда нажимать.
 */
export function MascotHero({ total, relay, width }: { total: number | null; relay: RelayView; width: number }) {
  const [open, setOpen] = useState(false);
  const height = Math.min(MASCOT_MAX_HEIGHT, mascotHeightFor(width * MASCOT_WIDTH_SHARE));

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.root, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${RELAY_TITLE}. Орехов: ${relay.nuts}`}
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen(true);
        }}
      >
        <View style={styles.row}>
          <Mascot height={height} />
          <View style={styles.side}>
            {total !== null ? (
              <>
                <Text style={styles.label}>Итог дня</Text>
                <Text style={styles.total}>{total}</Text>
                <Text style={styles.of}>из 100</Text>
              </>
            ) : null}
            <View style={styles.balance}>
              <NutsPill nuts={relay.nuts} />
            </View>
          </View>
        </View>
        <View style={styles.cta}>
          <RelayGlyph size={18} />
          <Text style={styles.ctaText}>{RELAY_TITLE}</Text>
          <Text style={styles.chevron}>›</Text>
        </View>
      </Pressable>
      <RelaySheet visible={open} relay={relay} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  side: { flex: 1, alignItems: 'center' },
  label: { color: colors.textMuted, fontSize: 15 },
  total: { color: colors.text, fontSize: 76, fontWeight: '200', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  of: { color: colors.textFaint, fontSize: 13, marginTop: -4 },
  balance: { marginTop: spacing.md },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.card,
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  ctaText: { color: colors.accent, fontSize: 16, fontWeight: '600', flex: 1 },
  chevron: { color: colors.accent, fontSize: 22, lineHeight: 24 },
});
