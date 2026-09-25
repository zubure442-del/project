import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RELAY_DAY_REWARD, formatCount, ladderPosition, nextRung, pluralRu, type RelayView } from '../domain';
import { CheckGlyph, FlameGlyph, NutGlyph, ShopItemGlyph, type ShopItem } from './RewardIcons';
import { Ring } from './Ring';
import { Sheet } from './Sheet';
import { colors, radius, spacing, withAlpha } from './theme';

/** Название игры — на кнопке под маскотом и в заголовке листа. */
export const RELAY_TITLE = 'Эстафета от Лиса';
/** Магазин живёт в том же листе и пока пуст. */
export const SHOP_TITLE = 'Магазин';
export const SHOP_EMPTY_TEXT = 'Скоро здесь появятся предметы';

/** Короткое объяснение игры: «i» рядом с заголовком листа. */
export const RELAY_INFO = {
  title: RELAY_TITLE,
  text:
    'Каждый день, когда вы доходите до своей нормы шагов, Лис приносит орехи — 5 за день. ' +
    'Дни подряд с выполненной нормой складываются в серию, и за длинные серии он приносит ещё.\n\n' +
    'Орехи копятся на балансе. В магазине их можно будет обменять на предметы для Лиса — наряды ' +
    'и мелочи для его площадки. Магазин пока пустой: вещи появятся в следующих обновлениях, ' +
    'а орехи до тех пор никуда не денутся.\n\n' +
    'Пропущенный день ничего не отнимает: серия просто начинается заново.',
} as const;

/** «Зелёный свет» — тот же зелёный, что у роста в динамике и у зелёной зоны кофейного окна. */
export const GREEN_LIGHT = colors.positive;

const STEP_FORMS = ['шаг', 'шага', 'шагов'] as const;
const NUT_FORMS = ['орех', 'ореха', 'орехов'] as const;
const DAY_FORMS = ['день', 'дня', 'дней'] as const;

/** Кольцо шагов дня в листе. */
const DAY_RING = 124;
/** Ступень лестницы на дорожке серии. */
const NODE = 38;
const RAIL = 4;
/** Место над дорожкой под огонёк «вы здесь». */
const FLAME_SPACE = 20;
/** Силуэты на пустой витрине магазина. */
const SHELF: ShopItem[] = ['hat', 'bow', 'ball'];

/** Баланс орехов в «Магазине». Одна форма и размер со значком серии — строки смотрятся однородно. */
export function NutsPill({ nuts }: { nuts: number }) {
  return (
    <View style={styles.badge} accessibilityLabel={`Баланс: ${nuts} ${pluralRu(nuts, NUT_FORMS)}`}>
      <NutGlyph size={16} />
      <Text style={styles.badgeText}>
        {formatCount(nuts)}
        <Text style={styles.badgeUnit}> {pluralRu(nuts, NUT_FORMS)}</Text>
      </Text>
    </View>
  );
}

/** Огонёк с числом дней серии. В листе к числу добавляется единица («дней»), в полоске — нет. */
export function StreakBadge({ streak, withUnit = false }: { streak: number; withUnit?: boolean }) {
  return (
    <View style={styles.badge} accessibilityLabel={`Серия: ${streak} ${pluralRu(streak, DAY_FORMS)} подряд`}>
      <FlameGlyph size={16} color={streak > 0 ? colors.accent : colors.textFaint} />
      <Text style={[styles.badgeText, streak === 0 && styles.faint]}>
        {streak}
        {withUnit ? <Text style={styles.badgeUnit}> {pluralRu(streak, DAY_FORMS)}</Text> : null}
      </Text>
    </View>
  );
}

/** Заголовок раздела листа: слева название, справа значок. У всех трёх разделов одинаковый. */
function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

/**
 * День: кольцо шагов к норме (тот же вид, что у колец оценок) и рядом — сколько осталось
 * или «Зелёный свет».
 */
function DayProgress({ relay }: { relay: RelayView }) {
  const share = relay.norm > 0 ? Math.min(1, relay.steps / relay.norm) : 0;
  return (
    <View style={styles.dayRow}>
      <Ring value={share * 100} size={DAY_RING} thickness={10} glow>
        <Text style={styles.ringSteps}>{formatCount(relay.steps)}</Text>
        <Text style={styles.ringNorm}>из {formatCount(relay.norm)}</Text>
      </Ring>
      <View style={styles.daySide}>
        {relay.met ? (
          <>
            <Text style={styles.greenLight}>Зелёный свет</Text>
            <Text style={styles.sub}>
              Норма выполнена · +{RELAY_DAY_REWARD} {pluralRu(RELAY_DAY_REWARD, NUT_FORMS)} завтра
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>До нормы осталось</Text>
            <Text style={styles.big}>{formatCount(relay.remaining)}</Text>
            <Text style={styles.sub}>{pluralRu(relay.remaining, STEP_FORMS)}</Text>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Серия как дорожка эстафеты: пять ступеней-наград на одной линии, линия залита от старта
 * до текущего дня серии, огонёк над ней — где вы сейчас. Полученные ступени залиты акцентом с галочкой,
 * следующая подсвечена. Ниже — сколько дней до следующей награды.
 */
function StreakTrack({ relay }: { relay: RelayView }) {
  const n = relay.ladder.length;
  const position = ladderPosition(relay.streak);
  // Ступени стоят по центрам пяти равных колонок; старт — левый край.
  const center = (k: number) => ((k - 0.5) / n) * 100;
  const fill = position <= 1 ? position * center(1) : ((position - 0.5) / n) * 100;
  const next = nextRung(relay.streak);
  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.rail, { width: `${center(n)}%` }]} />
        <View style={[styles.rail, styles.railOn, { width: `${fill}%` }]} />
        <View style={styles.ladder}>
          {relay.ladder.map((rung) => {
            const isNext = !rung.reached && next?.days === rung.days;
            return (
              <View key={rung.days} style={styles.rung}>
                <View style={[styles.node, isNext && styles.nodeNext, rung.reached && styles.nodeOn]}>
                  <Text style={[styles.nodeDays, isNext && styles.nodeDaysNext, rung.reached && styles.nodeDaysOn]}>
                    {rung.days}
                  </Text>
                  {rung.reached ? (
                    <View style={styles.check}>
                      <CheckGlyph size={9} color={colors.accent} />
                    </View>
                  ) : null}
                </View>
                <View style={styles.amount}>
                  <NutGlyph size={11} color={rung.reached || isNext ? colors.accent : colors.textFaint} />
                  <Text style={[styles.amountText, (rung.reached || isNext) && styles.amountOn]}>{formatCount(rung.nuts)}</Text>
                </View>
              </View>
            );
          })}
        </View>
        {/* Огонёк над дорожкой — где вы сейчас. */}
        {relay.streak > 0 ? (
          <View style={[styles.flame, { left: `${fill}%` }]}>
            <FlameGlyph size={16} />
          </View>
        ) : null}
      </View>
      <Text style={styles.nextText}>
        {next
          ? `Ещё ${next.left} ${pluralRu(next.left, DAY_FORMS)} подряд — и +${formatCount(next.nuts)} ${pluralRu(next.nuts, NUT_FORMS)}`
          : 'Все награды серии собраны'}
      </Text>
    </View>
  );
}

/**
 * «Эстафета»: сколько шагов осталось до нормы дня или «Зелёный свет» и серия на дорожке наград.
 */
export function RelayBody({ relay }: { relay: RelayView }) {
  return (
    <View>
      <DayProgress relay={relay} />
      <View style={styles.divider} />
      <SectionHead title="Серия" right={<StreakBadge streak={relay.streak} withUnit />} />
      <StreakTrack relay={relay} />
    </View>
  );
}

/**
 * Лист «Эстафета от Лиса»: всё про игру в одном месте — прогресс дня, серия на дорожке наград
 * и магазин с балансом орехов. Открывается нажатием на маскота с итогом дня.
 */
export function RelaySheet({ visible, relay, onClose }: { visible: boolean; relay: RelayView; onClose: () => void }) {
  return (
    <Sheet visible={visible} title={RELAY_TITLE} info={RELAY_INFO} onClose={onClose}>
      <RelayBody relay={relay} />
      <View style={styles.divider} />
      {/* Баланс стоит там, где его будут тратить, — в «Магазине». */}
      <SectionHead title={SHOP_TITLE} right={<NutsPill nuts={relay.nuts} />} />
      {/* Пустая витрина: силуэты будущих предметов вместо пустоты. */}
      <View style={styles.shelf}>
        {SHELF.map((item) => (
          <View key={item} style={styles.slot}>
            <ShopItemGlyph name={item} />
          </View>
        ))}
      </View>
      <Text style={styles.shopText}>{SHOP_EMPTY_TEXT}</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs },
  daySide: { flex: 1, gap: 2 },
  ringSteps: { color: colors.text, fontSize: 22, fontWeight: '300', fontVariant: ['tabular-nums'] },
  ringNorm: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  label: { color: colors.textMuted, fontSize: 13 },
  big: { color: colors.text, fontSize: 38, fontWeight: '200', fontVariant: ['tabular-nums'] },
  greenLight: { color: GREEN_LIGHT, fontSize: 26, fontWeight: '300' },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  faint: { color: colors.textFaint },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '500' },
  track: { position: 'relative', paddingTop: FLAME_SPACE },
  rail: {
    position: 'absolute',
    left: 0,
    top: FLAME_SPACE + NODE / 2 - RAIL / 2,
    height: RAIL,
    borderRadius: RAIL / 2,
    backgroundColor: colors.track,
  },
  railOn: { backgroundColor: colors.accent },
  flame: { position: 'absolute', top: 0, marginLeft: -8 },
  ladder: { flexDirection: 'row' },
  rung: { alignItems: 'center', gap: 6, flex: 1 },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    backgroundColor: colors.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeNext: { backgroundColor: withAlpha(colors.accent, 0.18) },
  nodeOn: { backgroundColor: colors.accent },
  nodeDays: { color: colors.textFaint, fontSize: 14, fontVariant: ['tabular-nums'] },
  nodeDaysNext: { color: colors.accent, fontWeight: '600' },
  nodeDaysOn: { color: colors.bg, fontWeight: '700' },
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
  nextText: { color: colors.textMuted, fontSize: 14, marginTop: spacing.md },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withAlpha(colors.accent, 0.12),
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { color: colors.accent, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  badgeUnit: { color: colors.accent, fontSize: 13, fontWeight: '400' },
  divider: { height: 1, backgroundColor: colors.track, marginVertical: spacing.lg },
  shelf: { flexDirection: 'row', gap: spacing.sm },
  slot: {
    flex: 1,
    height: 76,
    borderRadius: radius.card,
    backgroundColor: withAlpha(colors.track, 0.7),
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.md },
});
