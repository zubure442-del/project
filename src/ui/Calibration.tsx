import { StyleSheet, Text, View } from 'react-native';
import { Logo } from './Logo';
import { colors, spacing } from './theme';

export const CALIBRATION_TITLE = 'Считаем вашу активность';
export const CALIBRATION_TEXT =
  'Чтобы показатели за сегодня были точными, нам нужно больше данных. Дайте кольцу привыкнуть — осталось буквально несколько часов!';
/** Для прошлого дня обещать «несколько часов» нельзя: данных за него уже не прибавится. */
export const CALIBRATION_PAST_TEXT = 'За этот день данных недостаточно.';

/**
 * «Сегодня» для дня без всех трёх метрик. Частичные метрики и шаги здесь не показываем,
 * даже если что-то уже есть: неполная картина дня выглядела бы как оценка.
 */
export function Calibration({ today }: { today: boolean }) {
  return (
    <View style={styles.root}>
      <Logo size={72} />
      {today ? <Text style={styles.title}>{CALIBRATION_TITLE}</Text> : null}
      <Text style={styles.text}>{today ? CALIBRATION_TEXT : CALIBRATION_PAST_TEXT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 22, fontWeight: '500', textAlign: 'center' },
  text: { color: colors.textMuted, fontSize: 17, lineHeight: 25, textAlign: 'center' },
});
