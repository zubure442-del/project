import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { RingBle, handshake, runSync } from '../ble';
import type { Report } from '../domain';
import { EMPTY_STATE, addReport, clearState, loadState, saveState, type VueloState } from '../storage';
import { Today, colors, radius, spacing } from '../ui';
import { applySync, demoSync, findToday, reportMode, reportTitle, savedReport, spo2Fallback, todayKey } from './state';

export default function TodayScreen() {
  const ring = useRef<RingBle | null>(null);
  const [state, setState] = useState<VueloState>(EMPTY_STATE);
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Первый запуск: сразу показываем демо-данные, чтобы экран не был пустым.
  // Любая настоящая синхронизация их заменит.
  useEffect(() => {
    void loadState().then((loaded) => {
      if (loaded.days.length || loaded.demoDismissed) {
        setState(loaded);
        setReport(savedReport(loaded));
        return;
      }
      const seeded = applySync({ ...loaded, age: loaded.age ?? 30 }, demoSync(), new Date(), true);
      setState(seeded.state);
      setReport(seeded.report);
      void saveState(seeded.state);
    });
  }, []);

  const finish = useCallback(async (next: VueloState, nextReport: Report) => {
    const withReport: VueloState = {
      ...next,
      reports: addReport(next.reports, {
        date: todayKey(),
        mode: reportMode(new Date()),
        templateId: nextReport.templateId,
        text: nextReport.text,
      }),
    };
    setState(withReport);
    setReport(nextReport);
    await saveState(withReport);
  }, []);

  const syncFromRing = useCallback(async () => {
    setBusy(true);
    try {
      ring.current ??= new RingBle();
      const r = ring.current;
      r.onStatus = (s) => setStatus(s === 'scanning' ? 'Ищу кольцо…' : s === 'connecting' ? 'Подключаюсь…' : null);
      await r.connect();
      setStatus('Настраиваю кольцо…');
      await handshake(r);
      const result = await runSync(r, { onProgress: (m) => setStatus(`Выгружаю: ${m}`) });
      const next = applySync(state, result);
      await finish(next.state, next.report);
    } catch (e) {
      Alert.alert('Не вышло', e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }, [finish, state]);

  const forget = useCallback(async () => {
    setState(await clearState(true));
    setReport(null);
  }, []);

  const loadDemo = useCallback(async () => {
    setBusy(true);
    const next = applySync({ ...state, age: state.age ?? 30 }, demoSync(), new Date(), true);
    await finish(next.state, next.report);
    setBusy(false);
  }, [finish, state]);

  const today = useMemo(() => findToday(state.days) ?? (state.demo ? (state.days.at(-1) ?? null) : null), [state.days, state.demo]);
  const mode = reportMode(new Date());

  return (
    <View style={styles.root}>
      <Today
        today={today}
        week={state.days}
        report={report}
        reportTitle={reportTitle(mode)}
        battery={null}
        demo={state.demo}
        onForgetDemo={forget}
        spo2Fallback={spo2Fallback(state.days)}
        footer={
          <View style={styles.footer}>
            {status ? (
              <View style={styles.status}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.statusText}>{status}</Text>
              </View>
            ) : null}
            <Pressable style={[styles.button, busy && styles.busy]} onPress={syncFromRing} disabled={busy}>
              <Text style={styles.buttonText}>Синхронизировать кольцо</Text>
            </Pressable>
            <Pressable style={styles.link} onPress={state.demo ? forget : loadDemo} disabled={busy}>
              <Text style={styles.linkText}>{state.demo ? 'Убрать демо-данные' : 'Показать демо-данные'}</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  footer: { paddingHorizontal: spacing.md, marginTop: spacing.lg, gap: spacing.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.sm },
  statusText: { color: colors.textMuted, fontSize: 13 },
  button: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center' },
  busy: { opacity: 0.4 },
  buttonText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  link: { paddingVertical: spacing.sm, alignItems: 'center' },
  linkText: { color: colors.textMuted, fontSize: 14 },
});
