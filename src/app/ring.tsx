import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVuelo } from '../state';
import { colors, radius, spacing } from '../ui';

const DISCLAIMER =
  'Не медицинский прибор. Показатели носят справочный характер и не заменяют врача. ' +
  'Давление и глюкоза — оценка кольца. Данные хранятся только на этом телефоне.';

/** Лист «Кольцо»: заряд, последняя синхронизация, «забыть», «о приложении». */
export default function RingScreen() {
  const { state, statusText, forgetRing } = useVuelo();
  const insets = useSafeAreaInsets();
  const [about, setAbout] = useState(false);
  const [taps, setTaps] = useState(0);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const onVersion = () => {
    const next = taps + 1;
    setTaps(next);
    if (next >= 5) {
      setTaps(0);
      router.push('/raw-log');
    }
  };

  const forget = () =>
    Alert.alert('Забыть кольцо?', 'Данные на телефоне будут удалены, кольцо придётся найти заново.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Забыть',
        style: 'destructive',
        onPress: () => {
          forgetRing();
          router.back();
        },
      },
    ]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>{about ? 'О приложении' : 'Кольцо'}</Text>
        <Pressable onPress={() => (about ? setAbout(false) : router.back())} hitSlop={12}>
          <Text style={styles.action}>{about ? 'Назад' : 'Закрыть'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
        {about ? (
          <View style={styles.card}>
            <Text style={styles.text}>{DISCLAIMER}</Text>
            <Pressable onPress={onVersion} style={styles.versionRow}>
              <Text style={styles.version}>Версия {version}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Row label="Заряд" value={state.battery === null ? '—' : `${state.battery} %`} />
            <Divider />
            <Row label="Синхронизация" value={statusText.replace('Обновлено ', '')} />
            <Divider />
            <Pressable style={styles.row} onPress={() => setAbout(true)}>
              <Text style={styles.label}>О приложении</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Divider />
            <Pressable style={styles.row} onPress={forget}>
              <Text style={styles.danger}>Забыть кольцо</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
);

const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { color: colors.text, fontSize: 26, fontWeight: '600', flex: 1 },
  action: { color: colors.accent, fontSize: 16 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  label: { color: colors.text, fontSize: 16, flex: 1 },
  value: { color: colors.textMuted, fontSize: 16 },
  danger: { color: '#E5705F', fontSize: 16 },
  chevron: { color: colors.textFaint, fontSize: 22 },
  divider: { height: 1, backgroundColor: colors.track },
  text: { color: colors.textMuted, fontSize: 15, lineHeight: 22, paddingTop: spacing.md },
  versionRow: { paddingVertical: spacing.lg },
  version: { color: colors.textFaint, fontSize: 13 },
});
