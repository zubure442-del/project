import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, formulaText } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, DayActivityChart, InfoButton, Screen, Skeleton, Stat, WeekChart, colors, spacing, styles as ui } from '../../ui';

export default function ActivityTab() {
  const { week, state, phase, progress, packets, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const day = findDay(state.days, picked);
  const hours = day?.stepsByHour ?? [];
  const best = hours.length ? hours.indexOf(Math.max(...hours)) : -1;
  const chartWidth = width - spacing.md * 4;

  return (
    <Screen
      title="Активность"
      date={picked}
      statusText={statusText}
      loading={phase === 'background'}
      progress={progress}
      packets={packets}
      battery={state.battery}
      onSync={sync}
      onOpenRing={() => router.push('/ring')}
    >
      <View style={styles.head}>
        <Text style={styles.score}>{day?.scores.activity ?? '—'}</Text>
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.activity.title} text={formulaText('activity')} />}>
        <WeekChart days={week} value={(d) => d.scores.activity} selected={picked} onSelect={setPicked} width={chartWidth} />
      </Card>

      <Card title="День">
        {day ? (
          <DayActivityChart heart={day.heart} hours={hours} width={chartWidth} />
        ) : (
          <Skeleton height={130} />
        )}
        <View style={[ui.statRow, styles.stats]}>
          <Stat label="Шаги" value={day?.steps != null ? String(day.steps) : '—'} />
          <Stat label="Самый активный час" value={best >= 0 && hours[best] > 0 ? `${best}:00` : '—'} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', marginTop: spacing.md },
  score: { color: colors.text, fontSize: 72, fontWeight: '200' },
  stats: { marginTop: spacing.md },
});
