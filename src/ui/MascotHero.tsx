import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatCount, type RelayView, type Trend } from '../domain';
import { Mascot, mascotHeightFor } from './Mascot';
import { RELAY_TITLE, RelaySheet, StreakBadge } from './Relay';
import { TrendInline } from './WeekTrend';
import { colors, radius, spacing } from './theme';

/** Высота фигуры: не больше этого и не шире доли экрана, чтобы рядом поместилось число. */
const MASCOT_MAX_HEIGHT = 230;
const MASCOT_WIDTH_SHARE = 0.55;

/**
 * Блок маскота на «Сегодня»: фигура и итог дня рядом (не поверх). Под ними узкая полоска:
 * огонёк серии и шаги к норме — коротко, без лишних надписей. Вся область — от ушей до ног
 * вместе с числом и полоской — нажимается и открывает «Эстафету от Лиса»: там баланс орехов,
 * прогресс дня, лестница серии и магазин.
 */
export function MascotHero({
  total,
  relay,
  trend,
  width,
}: {
  total: number | null;
  relay: RelayView;
  trend: Trend;
  width: number;
}) {
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
                <View style={styles.trend}>
                  <TrendInline trend={trend} />
                </View>
              </>
            ) : null}
          </View>
        </View>
        <View style={styles.strip}>
          <StreakBadge streak={relay.streak} />
          <Text style={styles.steps}>
            {formatCount(relay.steps)}
            <Text style={styles.norm}> / {formatCount(relay.norm)}</Text>
          </Text>
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
  trend: { marginTop: spacing.sm, alignItems: 'center' },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.card,
    backgroundColor: colors.card,
  },
  steps: { color: colors.text, fontSize: 17, flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  norm: { color: colors.textMuted, fontSize: 15 },
  chevron: { color: colors.textFaint, fontSize: 20, lineHeight: 22 },
});
