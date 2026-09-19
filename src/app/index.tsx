import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RingBle, handshake, runSync } from '../ble';
import { formatWall } from '../codec';

/** ВРЕМЕННЫЙ экран диагностики для этапа 4. Настоящий экран «Сегодня» — этап 6. */
export default function DebugScreen() {
  const ring = useRef<RingBle | null>(null);
  const [log, setLog] = useState<string[]>(['Нажмите кнопку, кольцо должно быть рядом.']);
  const [busy, setBusy] = useState(false);
  const say = (m: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${m}`]);

  async function run() {
    setBusy(true);
    try {
      ring.current ??= new RingBle();
      const r = ring.current;
      r.onStatus = (s) => say(`статус: ${s}`);
      await r.connect();
      const hs = await handshake(r);
      say(`автозамер 0x19: ${hs.autoMeasure}`);
      const res = await runSync(r, { onProgress: say });
      say(`пакеты: ${JSON.stringify(res.packetCounts)}`);
      say(`шаги: ${res.steps.length} мин, сон: ${res.sleep.length} мин, пульс: ${res.heart.length}, SpO2: ${res.spo2.length}, сводка: ${res.summary.length}`);
      if (res.battery !== null) say(`заряд: ${res.battery}%`);
      if (res.activity) say(`сегодня шагов (0x03): ${res.activity.steps}`);
      for (const s of res.spo2.slice(-5)) say(`SpO2 ${formatWall(s.ts)}  ${s.value}%`);
      say('готово');
    } catch (e) {
      say(`ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Vuelo · диагностика</Text>
      <Pressable style={[styles.button, busy && styles.disabled]} onPress={run} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Работаю…' : 'Подключить и выгрузить'}</Text>
      </Pressable>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={styles.line}>{line}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F', paddingTop: 70, paddingHorizontal: 20 },
  title: { color: '#FFFFFF', fontSize: 32, fontWeight: '200', marginBottom: 20 },
  button: { backgroundColor: '#5EEAD4', borderRadius: 14, padding: 16, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#0B0B0F', fontSize: 17, fontWeight: '600' },
  log: { marginTop: 20 },
  line: { color: '#B4B4C0', fontSize: 13, marginBottom: 4, fontFamily: 'Menlo' },
});
