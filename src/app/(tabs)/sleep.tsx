import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, deepShareLabel, formulaText } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, Hypnogram, InfoButton, Screen, Skeleton, WeekChart, colors, spacing, withAlpha } from '../../ui';

const hhmm = (minutes: number) => `${Math.floor(minutes / 60)} ч ${minutes % 60} м`;

export default function SleepTab() {
  const { week, state, phase, progress, packets, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const day = findDay(state.days, picked);
  const sleep = day?.sleep;
  const chartWidth = width - spacing.md * 4;
  const deepShare = sleep && sleep.totalMin > 0 ? Math.round((sleep.deepMin / sleep.totalMin) * 100) : null;
  const lightShare = deepShare === null ? null : 100 - deepShare;

  return (
    <Screen
      title="Сон"
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
        <Text style={styles.score}>{day?.scores.sleep ?? '—'}</Text>
        {deepShare !== null ? <Text style={styles.label}>{deepShareLabel(deepShare)}</Text> : null}
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.sleep.title} text={formulaText('sleep')} />}>
        <WeekChart days={week} value={(d) => d.scores.sleep} selected={picked} onSelect={setPicked} width={chartWidth} />
      </Card>

      <Card title="Ночь">
        <Hypnogram segments={day?.sleepSegments ?? []} width={chartWidth} />
      </Card>

      <Card>
        {sleep ? (
          <>
            <Row label="Всего сна" value={hhmm(sleep.totalMin)} />
            <Row
              label="Глубокий"
              value={`${hhmm(sleep.deepMin)} · ${deepShare} %`}
              tail={deepShare === null ? undefined : deepShareLabel(deepShare)}
              dot={colors.accent}
              info={<InfoButton title={FORMULAS.deepShare.title} text={formulaText('deepShare')} />}
            />
            <Row label="Лёгкий" value={`${hhmm(sleep.lightMin)} · ${lightShare} %`} dot={withAlpha(colors.accent, 0.4)} />
            <Row label="Пульс во сне" value={day?.restingHrSource === 'night' && day.restingHr ? String(day.restingHr) : '—'} />
          </>
        ) : (
          <Skeleton height={96} />
        )}
      </Card>
    </Screen>
  );
}

function Row({
  label,
  value,
  tail,
  dot,
  info,
}: {
  label: string;
  value: string;
  tail?: string;
  dot?: string;
  info?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : <View style={styles.dotSpace} />}
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>
        {value}
        {tail ? <Text style={styles.tail}> · {tail}</Text> : null}
      </Text>
      {info}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', marginTop: spacing.md, gap: 2 },
  score: { color: colors.text, fontSize: 72, fontWeight: '200' },
  label: { color: colors.textMuted, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSpace: { width: 8 },
  rowLabel: { color: colors.textMuted, fontSize: 15, flex: 1 },
  rowValue: { color: colors.text, fontSize: 15 },
  tail: { color: colors.textMuted },
});
