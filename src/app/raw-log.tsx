import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearPacketLog, formatPacketLog, packetLog, subscribePacketLog, type LoggedPacket } from '../ble';
import { useVuelo } from '../state';
import { colors, radius, spacing } from '../ui';

const stamp = (at: number) => {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/** Меню разработчика: сырые пакеты кольца (время, направление, hex) для разбора и демо-режим. */
export default function RawLogScreen() {
  const insets = useSafeAreaInsets();
  const { demo, setDemo } = useVuelo();
  const [items, setItems] = useState<LoggedPacket[]>(packetLog);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribePacketLog(() => setItems(packetLog())), []);

  const copy = async () => {
    await Clipboard.setStringAsync(formatPacketLog(items));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>Назад</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Сырой лог</Text>
          <View style={styles.spacer} />
          <Pressable style={styles.button} onPress={copy} disabled={!items.length}>
            <Text style={styles.buttonText}>{copied ? 'Скопировано' : 'Скопировать'}</Text>
          </Pressable>
          <Pressable style={styles.clear} onPress={() => clearPacketLog()} hitSlop={8}>
            <Text style={styles.clearText}>Очистить</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>
          {items.length ? `${items.length} пакетов · «<-» от кольца, «->» команды приложения` : 'Пакетов пока нет.'}
        </Text>
        {/* Демо: синтетические показатели через настоящий расчёт; реальные данные не трогаются. */}
        <Pressable style={[styles.button, styles.demo]} onPress={() => setDemo(!demo)}>
          <Text style={styles.buttonText}>{demo ? 'Выключить демо-режим' : 'Демо-режим'}</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.log}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
      >
        {items.length ? (
          items.map((p, i) => (
            <Text key={i} style={styles.line} selectable>
              {stamp(p.at)} {p.direction === 'in' ? '<-' : p.direction === 'out' ? '->' : '#'} {p.hex}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>
            Нажмите «Обновить» на любой вкладке, подключитесь к кольцу — и здесь появятся все пакеты.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  back: { color: colors.accent, fontSize: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: 28, fontWeight: '500' },
  spacer: { flex: 1 },
  button: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  buttonText: { color: colors.bg, fontSize: 13, fontWeight: '600' },
  demo: { alignSelf: 'flex-start', marginTop: spacing.xs },
  clear: { paddingHorizontal: 4 },
  clearText: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textMuted, fontSize: 12.5 },
  log: { flex: 1 },
  line: { color: colors.textMuted, fontSize: 11.5, fontFamily: 'Menlo', marginBottom: 3 },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
});
