import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TipGlyph } from './TipIcons';
import { colors, spacing } from './theme';

export const CALIBRATION_TITLE = 'Считаем вашу активность';
/** Первые дни: кольцо ещё ни разу не дало полный день. */
export const CALIBRATION_TEXT =
  'Чтобы показатели за сегодня были точными, нам нужно больше данных. Дайте кольцу привыкнуть — осталось буквально несколько часов!';
/** Полные дни уже были: человеку важно знать, когда ждать сегодняшние. */
export const CALIBRATION_RETURNING_TEXT = 'Данные за сегодня начнут появляться утром, после вашего сна.';
/** Для прошлого дня обещать что-то нельзя: данных за него уже не прибавится. */
export const CALIBRATION_PAST_TEXT = 'За этот день данных недостаточно.';

/** Песочные часы: данные за сегодня ещё копятся. */
function Hourglass({ size = 64 }: { size?: number }) {
  const p = { stroke: colors.accent, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...p} fill="none" d="M6 3h12M6 21h12M7 3c0 4.5 5 6 5 9s-5 4.5-5 9M17 3c0 4.5-5 6-5 9s5 4.5 5 9" />
      <Path d="M9.2 18.6c.9-1.4 2.8-2.1 2.8-3.6 0 1.5 1.9 2.2 2.8 3.6z" fill={colors.accent} opacity={0.85} />
      <Path d="M9.8 6.8h4.4c-.6 1-1.4 1.6-2.2 2.2-.8-.6-1.6-1.2-2.2-2.2z" fill={colors.accent} opacity={0.5} />
    </Svg>
  );
}

/** Размер знака над текстом экрана калибровки. */
const GLYPH_SIZE = 64;

/**
 * «Сегодня» для дня без всех трёх метрик. Частичные метрики и шаги здесь не показываем,
 * даже если что-то уже есть: неполная картина дня выглядела бы как оценка.
 * Сегодня — песочные часы (данные ещё придут). Прошлый день — знак «i» из набора подсказок:
 * данных за него уже не прибавится, и значок ожидания обещал бы лишнее.
 * Маскота и его полоску на этом экране не показываем: пока считать нечего, там пусто.
 */
export function Calibration({ today, returning = false }: { today: boolean; returning?: boolean }) {
  const text = !today ? CALIBRATION_PAST_TEXT : returning ? CALIBRATION_RETURNING_TEXT : CALIBRATION_TEXT;
  return (
    <View style={styles.root}>
      {today ? <Hourglass size={GLYPH_SIZE} /> : <TipGlyph name="info" size={GLYPH_SIZE} />}
      {today ? <Text style={styles.title}>{CALIBRATION_TITLE}</Text> : null}
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 22, fontWeight: '500', textAlign: 'center' },
  text: { color: colors.textMuted, fontSize: 17, lineHeight: 25, textAlign: 'center' },
});
