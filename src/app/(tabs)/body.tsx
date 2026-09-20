import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, STRESS_ZONE_BOUNDS, formulaText, stressZone } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, DayLineChart, InfoButton, PressureChart, Screen, Skeleton, WeekChart, colors, spacing } from '../../ui';

export default function BodyTab() {
  const { week, state, phase, progress, packets, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const day = findDay(state.days, picked);
  const chartWidth = width - spacing.md * 4;
  const est = day?.estimates;

  const hrv = (day?.summaryPoints ?? []).filter((p) => p.hrv !== null).map((p) => ({ m: p.m, v: p.hrv as number }));
  const glucose = (day?.summaryPoints ?? []).filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));
  const pressure = (day?.summaryPoints ?? [])
    .filter((p) => p.systolic !== null && p.diastolic !== null)
    .map((p) => ({ m: p.m, sys: p.systolic as number, dia: p.diastolic as number }));

  return (
    <Screen
      title="Тело"
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
        <Text style={styles.score}>{day?.scores.state ?? '—'}</Text>
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.state.title} text={formulaText('state')} />}>
        <WeekChart days={week} value={(d) => d.scores.state} selected={picked} onSelect={setPicked} width={chartWidth} />
      </Card>

      <Card title="Стресс" right={<InfoButton title={FORMULAS.stress.title} text={formulaText('stress')} />}>
        <DayLineChart points={day?.stress ?? []} width={chartWidth} yMin={0} yMax={100} guides={STRESS_ZONE_BOUNDS} />
        {est?.stress != null ? (
          <Text style={styles.value}>
            {Math.round(est.stress)} · {stressZone(Math.round(est.stress)) ?? '—'}
          </Text>
        ) : null}
      </Card>

      <Card title="Вариабельность" right={<InfoButton title={FORMULAS.hrv.title} text={formulaText('hrv')} />}>
        {day ? <DayLineChart points={hrv} width={chartWidth} /> : <Skeleton height={130} />}
        {est?.hrv != null ? <Text style={styles.value}>{Math.round(est.hrv)} мс</Text> : null}
      </Card>

      <Card title="Давление · оценка" right={<InfoButton title={FORMULAS.pressure.title} text={formulaText('pressure')} />}>
        <PressureChart points={pressure} width={chartWidth} />
        {est?.systolic != null ? (
          <Text style={styles.value}>
            {Math.round(est.systolic)}/{Math.round(est.diastolic ?? 0)}
          </Text>
        ) : null}
      </Card>

      <Card title="Глюкоза · оценка" right={<InfoButton title={FORMULAS.glucose.title} text={formulaText('glucose')} />}>
        <DayLineChart points={glucose} width={chartWidth} format={(v) => v.toFixed(1)} />
        {est?.glucose != null ? <Text style={styles.value}>{est.glucose.toFixed(1)} ммоль/л</Text> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', marginTop: spacing.md },
  score: { color: colors.text, fontSize: 72, fontWeight: '200' },
  value: { color: colors.textMuted, fontSize: 14, marginTop: spacing.xs },
});
