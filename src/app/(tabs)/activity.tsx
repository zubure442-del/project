import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  Card,
  Screen,
  Stat,
  StepsHourChart,
  WEEK_METRIC_CAPTION,
  WEEK_METRIC_LABEL,
  WeekChart,
  colors,
  radius,
  spacing,
  styles as ui,
  type WeekMetric,
} from '../../ui';
import { useVuelo } from '../../state';

const METRICS: WeekMetric[] = ['total', 'sleep', 'steps'];

/** «Активность»: шаги по часам и неделя с переключателем показателя. */
export default function ActivityTab() {
  const { today, week, state, busy, progress, statusText, sync, setDemo } = useVuelo();
  const { width } = useWindowDimensions();
  const [metric, setMetric] = useState<WeekMetric>('total');
  const chartWidth = width - spacing.md * 4;
  const hours = today?.stepsByHour ?? [];
  const bestHour = hours.length ? hours.indexOf(Math.max(...hours)) : null;

  return (
    <Screen
      title="Активность"
      statusText={statusText}
      busy={busy}
      progress={progress}
      demo={state.demo}
      onSync={sync}
      onForgetDemo={() => setDemo(false)}
      onOpenSettings={() => router.push('/settings')}
    >
      <Card title="Шаги по часам" note="сегодня">
        <StepsHourChart hours={hours} width={chartWidth} />
      </Card>

      <Card title="За день">
        <View style={ui.statRow}>
          <Stat label="Шаги" value={today?.steps != null ? String(today.steps) : '—'} />
          <Stat
            label="Самый активный час"
            value={bestHour !== null && hours[bestHour] > 0 ? `${bestHour}:00` : '—'}
          />
          <Stat label="Оценка активности" value={today?.scores.activity != null ? String(today.scores.activity) : '—'} unit="из 100" />
        </View>
      </Card>

      <Card title="Неделя" note={WEEK_METRIC_CAPTION[metric]}>
        <View style={styles.switcher}>
          {METRICS.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMetric(m)}
              style={[styles.tab, metric === m && styles.tabActive]}
            >
              <Text style={[styles.tabText, metric === m && styles.tabTextActive]}>{WEEK_METRIC_LABEL[m]}</Text>
            </Pressable>
          ))}
        </View>
        <WeekChart days={week} metric={metric} width={chartWidth} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  switcher: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.track },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: colors.bg },
});
