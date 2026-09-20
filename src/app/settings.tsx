import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVuelo } from '../state';
import { Card, colors, spacing, styles as ui } from '../ui';

export default function SettingsScreen() {
  const { state, setDemo, statusText } = useVuelo();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>Назад</Text>
        </Pressable>
        <Text style={styles.title}>Настройки</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <Card title="Данные">
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Демо-данные</Text>
              <Text style={styles.rowNote}>
                Показывает выдуманную неделю на всех вкладках, чтобы посмотреть приложение без кольца.
                Настоящая синхронизация их заменит.
              </Text>
            </View>
            <Switch
              value={state.demo}
              onValueChange={setDemo}
              trackColor={{ false: colors.track, true: colors.accent }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Text style={[ui.disclaimer, styles.statusLine]}>{statusText}</Text>
        </Card>

        <Card title="Диагностика">
          <Pressable style={styles.link} onPress={() => router.push('/raw-log')}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Сырой лог</Text>
              <Text style={styles.rowNote}>Все пакеты кольца в hex. Можно скопировать и прислать на разбор.</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Card>

        <Card title="О приложении">
          <Text style={ui.disclaimer}>
            Данные хранятся только на телефоне: сервера и базы данных нет. Глюкозу и давление кольцо оценивает по
            пульсовой волне, а не измеряет; приложение не делает по ним выводов и не даёт медицинских рекомендаций.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  back: { color: colors.accent, fontSize: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 16, marginBottom: 3 },
  rowNote: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chevron: { color: colors.textMuted, fontSize: 26 },
  statusLine: { marginTop: spacing.md, borderTopColor: colors.cardBorder, borderTopWidth: 1, paddingTop: spacing.sm },
});
