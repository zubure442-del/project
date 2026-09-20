import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { deepShareLabel } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, InfoButton, Screen, SleepBar, Stat, WeekStrip, colors, spacing, styles as ui } from '../../ui';

const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}ч ${minutes % 60}м`;

export default function SleepTab() {
  const { week, state, busy, progress, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const [metric, setMetric] = useState('score');
  const day = findDay(state.days, picked);
  const sleep = day?.sleep;
  const deepShare = sleep && sleep.totalMin > 0 ? Math.round((sleep.deepMin / sleep.totalMin) * 100) : null;

  return (
    <Screen
      title="Сон"
      statusText={statusText}
      busy={busy}
      progress={progress}
      battery={state.battery}
      onSync={sync}
      onOpenRing={() => router.push('/ring')}
    >
      <WeekStrip
        days={week}
        metrics={[
          { id: 'score', label: 'Оценка', value: (d) => d.scores.sleep },
          {
            id: 'duration',
            label: 'Длительность',
            value: (d) => (d.sleep ? Math.round((d.sleep.totalMin / 60) * 10) / 10 : null),
            format: (v) => `${v}ч`,
          },
        ]}
        metricId={metric}
        onMetric={setMetric}
        selected={picked}
        onSelect={setPicked}
      />

      <Card title="Ночь">
        <SleepBar segments={day?.sleepSegments ?? []} width={width - spacing.md * 4} />
      </Card>

      <Card>
        <View style={ui.statRow}>
          <Stat label="Всего" value={sleep ? hhmm(sleep.totalMin) : '—'} />
          <Stat
            label={deepShare !== null ? `Глубокий · ${deepShareLabel(deepShare)}` : 'Глубокий'}
            value={deepShare !== null ? `${deepShare}` : '—'}
            unit={deepShare !== null ? '%' : undefined}
          />
        </View>
      </Card>

      <Card
        title="Оценка сна"
        right={
          <InfoButton
            title="Оценка сна"
            text="Складывается из длительности и доли глубокой фазы. Семь часов сна с глубокой фазой около 20 процентов дают максимум. Если кольцо не записало ночь, оценки нет и в итог она не идёт."
          />
        }
      >
        <Text style={styles.score}>{day?.scores.sleep ?? '—'}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  score: { color: colors.text, fontSize: 40, fontWeight: '200' },
});
