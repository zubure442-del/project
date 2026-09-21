import { StyleSheet, Text, View } from 'react-native';
import { Logo } from './Logo';
import { colors, spacing } from './theme';

export const CALIBRATION_TEXT = 'Данные ещё собираются. Поносите кольцо ещё несколько часов и зайдите снова.';

/**
 * «Сегодня» для дня без всех трёх метрик. Частичные метрики и шаги здесь не показываем,
 * даже если что-то уже есть: неполная картина дня выглядела бы как оценка.
 */
export function Calibration() {
  return (
    <View style={styles.root}>
      <Logo size={72} />
      <Text style={styles.text}>{CALIBRATION_TEXT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.xl * 2 },
  text: { color: colors.textMuted, fontSize: 17, lineHeight: 25, textAlign: 'center' },
});
