import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, radius, spacing } from './theme';

/** Общий лист снизу. Все пояснения в приложении показываются только через него. */
export function Sheet({
  visible,
  title,
  info,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  /** Необязательный «i» рядом с заголовком листа: короткое объяснение, что это за раздел. */
  info?: { title: string; text: string };
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          {info ? <InfoButton title={info.title} text={info.text} /> : null}
          <View style={styles.headSpacer} />
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Закрыть</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.body}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

/** Значок «i». Текст объяснения живёт в листе, а не на карточке. */
export function InfoButton({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={12}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="9.5" stroke={colors.textFaint} strokeWidth="1.6" fill="none" />
          <Path d="M12 10.5v6" stroke={colors.textFaint} strokeWidth="1.9" strokeLinecap="round" />
          <Circle cx="12" cy="7.4" r="1.2" fill={colors.textFaint} />
        </Svg>
      </Pressable>
      <Sheet visible={open} title={title} onClose={() => setOpen(false)}>
        <Text style={styles.text}>{text}</Text>
      </Sheet>
    </>
  );
}

export const sheetStyles = StyleSheet.create({
  text: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowLabel: { color: colors.text, fontSize: 16, flex: 1 },
  rowValue: { color: colors.textMuted, fontSize: 16 },
  action: { color: colors.accent, fontSize: 16 },
  divider: { height: 1, backgroundColor: colors.track },
});

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.card + 6,
    borderTopRightRadius: radius.card + 6,
    paddingHorizontal: spacing.lg,
    maxHeight: '75%',
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.track, alignSelf: 'center', marginTop: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  title: { color: colors.text, fontSize: 20, fontWeight: '600', flexShrink: 1 },
  headSpacer: { flex: 1 },
  close: { color: colors.accent, fontSize: 16 },
  body: { marginBottom: spacing.sm },
  text: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
});
