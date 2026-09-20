import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, InfoButton, Screen, Stat, StepsHourChart, WeekStrip, colors, spacing, styles as ui } from '../../ui';

export default function ActivityTab() {
  const { week, state, busy, progress, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState<string | null>(null);
  const [metric, setMetric] = useState('score');
  const date = picked ?? todayKey();
  const day = findDay(state.days, date);
  const hours = day?.stepsByHour ?? [];
  const best = hours.length ? hours.indexOf(Math.max(...hours)) : -1;

  return (
    <Screen
      title="Активность"
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
          { id: 'score', label: 'Оценка', value: (d) => d.scores.activity },
          { id: 'steps', label: 'Шаги', value: (d) => d.steps },
        ]}
        metricId={metric}
        onMetric={setMetric}
        selected={date}
        onSelect={setPicked}
      />

      <Card>
        <View style={ui.statRow}>
          <Stat label="Шаги" value={day?.steps != null ? String(day.steps) : '—'} />
          <Stat label="Активный час" value={best >= 0 && hours[best] > 0 ? `${best}:00` : '—'} />
        </View>
      </Card>

      {picked ? (
        <Card title="Шаги по часам">
          <StepsHourChart hours={hours} width={width - spacing.md * 4} />
        </Card>
      ) : (
        <Card>
          <Text style={styles.hint}>Выберите день наверху, чтобы увидеть шаги по часам.</Text>
        </Card>
      )}

      <Card
        title="Оценка активности"
        right={
          <InfoButton
            title="Оценка активности"
            text="Основа — шаги: десять тысяч дают максимум. Время с высоким пульсом добавляет сверху. Оценка растёт в течение дня, поэтому утром она всегда низкая."
          />
        }
      >
        <Text style={styles.score}>{day?.scores.activity ?? '—'}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  score: { color: colors.text, fontSize: 40, fontWeight: '200' },
  hint: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
});
