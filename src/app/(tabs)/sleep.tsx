import { router } from 'expo-router';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Card, Hypnogram, Screen, Stat, colors, spacing, styles as ui } from '../../ui';
import { useVuelo } from '../../state';

/** «Сон»: гипнограмма за ночь, общее время и доля глубокого сна. */
export default function SleepTab() {
  const { today, state, busy, progress, statusText, sync, setDemo } = useVuelo();
  const { width } = useWindowDimensions();
  const chartWidth = width - spacing.md * 4;
  const sleep = today?.sleep;
  const deepShare = sleep && sleep.totalMin > 0 ? Math.round((sleep.deepMin / sleep.totalMin) * 100) : null;
  const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}ч ${minutes % 60}м`;

  return (
    <Screen
      title="Сон"
      statusText={statusText}
      busy={busy}
      progress={progress}
      demo={state.demo}
      onSync={sync}
      onForgetDemo={() => setDemo(false)}
      onOpenSettings={() => router.push('/settings')}
    >
      <Card title="Ночь" note="фазы по времени">
        <Hypnogram segments={today?.sleepSegments ?? []} width={chartWidth} />
      </Card>

      <Card title="Итоги ночи">
        <View style={ui.statRow}>
          <Stat label="Всего сна" value={sleep ? hhmm(sleep.totalMin) : '—'} />
          <Stat label="Доля глубокого" value={deepShare !== null ? String(deepShare) : '—'} unit={deepShare !== null ? '%' : undefined} />
          <Stat label="Глубокий" value={sleep ? hhmm(sleep.deepMin) : '—'} />
          <Stat label="Лёгкий" value={sleep ? hhmm(sleep.lightMin) : '—'} />
        </View>
        {sleep ? null : <Text style={styles.note}>За эту ночь кольцо не записало сон.</Text>}
      </Card>

      <Card title="Оценка сна">
        <Text style={styles.score}>{today?.scores.sleep ?? '—'}</Text>
        <Text style={styles.note}>
          Оценка из 100. Считается по длительности сна и доле глубокой фазы. Если данных за ночь нет, оценка не выставляется
          и в итог не идёт.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  score: { color: colors.text, fontSize: 44, fontWeight: '100' },
  note: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: spacing.sm },
});
