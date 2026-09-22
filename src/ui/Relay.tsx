import { StyleSheet, Text, View } from 'react-native';
import { RELAY_DAY_REWARD, formatCount, pluralRu, type RelayView } from '../domain';
import { CheckGlyph, FlameGlyph, NutGlyph } from './RewardIcons';
import { Sheet } from './Sheet';
import { colors, radius, spacing, withAlpha } from './theme';

/** Название игры — на кнопке под маскотом и в заголовке листа. */
export const RELAY_TITLE = 'Эстафета от Лиса';
/** Магазин живёт в том же листе и пока пуст. */
export const SHOP_TITLE = 'Магазин';
export const SHOP_EMPTY_TEXT = 'Скоро здесь появятся предметы';

/** «Зелёный свет» — единственный зелёный на карточке, тот же, что у зелёной зоны кофейного окна. */
export const GREEN_LIGHT = '#5DBB8C';

const STEP_FORMS = ['шаг', 'шага', 'шагов'] as const;
const NUT_FORMS = ['орех', 'ореха', 'орехов'] as const;
const DAY_FORMS = ['день', 'дня', 'дней'] as const;

/** Баланс орехов. Крупный — рядом с маскотом на «Сегодня», ещё крупнее — в листе. */
export function NutsPill({ nuts, big = false }: { nuts: number; big?: boolean }) {
  return (
    <View style={[styles.pill, big && styles.pillBig]}>
      <NutGlyph size={big ? 26 : 20} />
      <Text style={[styles.pillText, big && styles.pillTextBig]}>{formatCount(nuts)}</Text>
      {big ? <Text style={styles.pillUnit}>{pluralRu(nuts, NUT_FORMS)}</Text> : null}
    </View>
  );
}

/** Огонёк с числом дней серии. */
export function StreakBadge({ streak }: { streak: number }) {
  return (
    <View style={styles.streak} accessibilityLabel={`Серия: ${streak} ${pluralRu(streak, DAY_FORMS)} подряд`}>
      <FlameGlyph size={16} color={streak > 0 ? colors.accent : colors.textFaint} />
      <Text style={[styles.streakText, streak === 0 && styles.faint]}>{streak}</Text>
    </View>
  );
}

/**
 * «Эстафета»: сколько шагов осталось до нормы дня или «Зелёный свет», полоска к норме
 * и лестница серии — все пять ступеней, полученные залиты акцентом и отмечены галочкой.
 */
export function RelayBody({ relay }: { relay: RelayView }) {
  const share = relay.norm > 0 ? Math.min(1, relay.steps / relay.norm) : 0;
  return (
    <View style={styles.body}>
      {relay.met ? (
        <View style={styles.block}>
          <Text style={[styles.big, { color: GREEN_LIGHT }]}>Зелёный свет</Text>
          <Text style={styles.sub}>
            Норма выполнена · +{RELAY_DAY_REWARD} {pluralRu(RELAY_DAY_REWARD, NUT_FORMS)} завтра
          </Text>
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.label}>До нормы осталось</Text>
          <Text style={styles.big}>
            {formatCount(relay.remaining)}
            <Text style={styles.unit}> {pluralRu(relay.remaining, STEP_FORMS)}</Text>
          </Text>
        </View>
      )}

      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${share * 100}%`, backgroundColor: relay.met ? GREEN_LIGHT : colors.accent }]} />
      </View>
      <Text style={styles.faintText}>
        {formatCount(relay.steps)} из {formatCount(relay.norm)}
      </Text>

      <View style={styles.streakRow}>
        <Text style={styles.label}>Серия</Text>
        <Text style={styles.streakDays}>
          {relay.streak} {pluralRu(relay.streak, DAY_FORMS)} подряд
        </Text>
        <StreakBadge streak={relay.streak} />
      </View>
      <View style={styles.ladder}>
        {relay.ladder.map((rung) => (
          <View key={rung.days} style={styles.rung}>
            <View style={[styles.circle, rung.reached && styles.circleOn]}>
              <Text style={[styles.rungDays, rung.reached && styles.rungDaysOn]}>{rung.days}</Text>
              {rung.reached ? (
                <View style={styles.check}>
                  <CheckGlyph size={9} color={colors.accent} />
                </View>
              ) : null}
            </View>
            <View style={styles.amount}>
              <NutGlyph size={11} color={rung.reached ? colors.accent : colors.textFaint} />
              <Text style={[styles.amountText, rung.reached && styles.amountOn]}>{formatCount(rung.nuts)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Лист «Эстафета от Лиса»: всё про игру в одном месте — баланс орехов, прогресс дня,
 * серия с лестницей и магазин. Открывается нажатием на маскота с итогом дня.
 */
export function RelaySheet({ visible, relay, onClose }: { visible: boolean; relay: RelayView; onClose: () => void }) {
  return (
    <Sheet visible={visible} title={RELAY_TITLE} onClose={onClose}>
      <View style={styles.sheetHead}>
        <NutsPill nuts={relay.nuts} big />
      </View>
      <RelayBody relay={relay} />
      <View style={styles.divider} />
      <Text style={styles.shopTitle}>{SHOP_TITLE}</Text>
      <View style={styles.shopEmpty}>
        <NutGlyph size={34} color={colors.textFaint} />
        <Text style={styles.shopText}>{SHOP_EMPTY_TEXT}</Text>
      </View>
    </Sheet>
  );
}

const CIRCLE = 40;

const styles = StyleSheet.create({
  body: { gap: spacing.xs },
  block: { gap: 2 },
  label: { color: colors.textMuted, fontSize: 13 },
  big: { color: colors.text, fontSize: 38, fontWeight: '200', fontVariant: ['tabular-nums'] },
  unit: { color: colors.textMuted, fontSize: 15, fontWeight: '400' },
  sub: { color: colors.textMuted, fontSize: 14 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.track, overflow: 'hidden', marginTop: spacing.xs },
  barFill: { height: '100%', borderRadius: 3 },
  faintText: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  faint: { color: colors.textFaint },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  streakDays: { color: colors.text, fontSize: 15, flex: 1 },
  ladder: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  rung: { alignItems: 'center', gap: 6, flex: 1 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: colors.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOn: { backgroundColor: colors.accent },
  rungDays: { color: colors.textMuted, fontSize: 14, fontVariant: ['tabular-nums'] },
  rungDaysOn: { color: colors.bg, fontWeight: '700' },
  check: {
    position: 'absolute',
    right: -3,
    top: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  amountText: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  amountOn: { color: colors.accent },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withAlpha(colors.accent, 0.12),
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  streakText: { color: colors.accent, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: withAlpha(colors.accent, 0.14),
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pillBig: { paddingHorizontal: 16, paddingVertical: 8 },
  pillText: { color: colors.accent, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pillTextBig: { fontSize: 28, fontWeight: '500' },
  pillUnit: { color: colors.textMuted, fontSize: 14, marginLeft: 2 },
  sheetHead: { alignItems: 'center', paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.track, marginVertical: spacing.lg },
  shopTitle: { color: colors.text, fontSize: 17, fontWeight: '500' },
  shopEmpty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  shopText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
});
