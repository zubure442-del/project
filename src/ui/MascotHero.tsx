import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { DAY_PROGRESS_LABEL, formatCount, type RelayView } from '../domain';
import { MASCOT_SKINS, Mascot, mascotHeightFor } from './Mascot';
import { RELAY_TITLE, RelaySheet, StreakBadge } from './Relay';
import { colors, radius, spacing } from './theme';

/**
 * Кадр маскота (с полями и платформой) не выше этого, pt: столько занимала прежняя картинка, и блок
 * «AI Ассистент» под ним помещается на «Сегодня» без прокрутки. И не шире доли экрана, чтобы рядом
 * поместилось число.
 */
const MASCOT_MAX_BOX_HEIGHT = 245;
const MASCOT_WIDTH_SHARE = 0.55;
/** Короткое касание почти без сдвига — нажатие, даже если его перехватила прокрутка. */
const TAP_MAX_MOVE = 10;
const TAP_MAX_MS = 500;
const { frame, figure } = MASCOT_SKINS.fox;
const MASCOT_MAX_HEIGHT = (MASCOT_MAX_BOX_HEIGHT * figure) / frame.height;

/**
 * Блок маскота на «Сегодня»: фигура и прогресс дня рядом (не поверх). Сравнения с неделей
 * здесь нет — только само число. Под ними узкая полоска:
 * огонёк серии и шаги к норме — коротко, без лишних надписей. Вся область — от ушей до ног
 * вместе с числом и полоской — нажимается и открывает «Эстафету от Лиса»: там баланс орехов,
 * прогресс дня, лестница серии и магазин.
 */
export function MascotHero({
  total,
  relay,
  width,
}: {
  total: number | null;
  relay: RelayView;
  width: number;
}) {
  const [open, setOpen] = useState(false);
  const height = Math.min(MASCOT_MAX_HEIGHT, mascotHeightFor(width * MASCOT_WIDTH_SHARE));

  // Владелец 26.09: «скроллю и резко нажимаю на лиса — эстафета не открывается». Пока экран ещё
  // докатывается после прокрутки или пружинит после жеста обновления, iOS отдаёт первое касание
  // прокрутке (чтобы её остановить), и onPress не приходит. Поэтому ловим и само касание:
  // короткое и почти без сдвига — это нажатие.
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const openedAt = useRef(0);
  const openRelay = () => {
    // Касание и onPress могут прийти оба — открываем один раз.
    if (Date.now() - openedAt.current < 600) return;
    openedAt.current = Date.now();
    void Haptics.selectionAsync();
    setOpen(true);
  };
  const onTouchStart = (e: GestureResponderEvent) => {
    touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now() };
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const moved = Math.hypot(e.nativeEvent.pageX - start.x, e.nativeEvent.pageY - start.y);
    if (moved <= TAP_MAX_MOVE && Date.now() - start.at <= TAP_MAX_MS) openRelay();
  };

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.root, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${RELAY_TITLE}. Орехов: ${relay.nuts}`}
        onPress={openRelay}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <View style={styles.row}>
          <Mascot height={height} />
          <View style={styles.side}>
            {total !== null ? (
              <>
                <Text style={styles.label}>{DAY_PROGRESS_LABEL}</Text>
                <Text style={styles.total}>{total}</Text>
                <Text style={styles.of}>из 100</Text>
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
