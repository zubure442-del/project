import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { FORMULAS, STRESS_ZONE_BOUNDS, formulaText } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, DayLineChart, HeroRing, InfoButton, PressureChart, Screen, WeekChart, spacing } from '../../ui';

export default function BodyTab() {
  const { week, state, phase, progress, packets, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const day = findDay(state.days, picked);
  const chartWidth = width - spacing.md * 4;
  const points = day?.summaryPoints ?? [];

  const hrv = points.filter((p) => p.hrv !== null).map((p) => ({ m: p.m, v: p.hrv as number }));
  const glucose = points.filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));
  const pressure = points
    .filter((p) => p.systolic !== null && p.diastolic !== null)
    .map((p) => ({ m: p.m, sys: p.systolic as number, dia: p.diastolic as number }));
  const stress = day?.stress ?? [];

  return (
    <Screen
      title="Тело"
      date={picked}
      statusText={statusText}
      loading={phase === 'background'}
      progress={progress}
      packets={packets}
      onSync={sync}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.state ?? null} />
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.state.title} text={formulaText('state')} />}>
        <WeekChart days={week} value={(d) => d.scores.state} selected={picked} onSelect={setPicked} width={chartWidth} />
      </Card>

      {/* Пустые карточки не показываем вовсе: рамка без данных ничего не говорит. */}
      {stress.length ? (
        <Card title="Стресс" right={<InfoButton title={FORMULAS.stress.title} text={formulaText('stress')} />}>
          <DayLineChart points={stress} width={chartWidth} yMin={0} yMax={100} guides={STRESS_ZONE_BOUNDS} />
        </Card>
      ) : null}

      {hrv.length ? (
        <Card title="Вариабельность" right={<InfoButton title={FORMULAS.hrv.title} text={formulaText('hrv')} />}>
          <DayLineChart points={hrv} width={chartWidth} />
        </Card>
      ) : null}

      {pressure.length ? (
        <Card title="Давление · оценка" right={<InfoButton title={FORMULAS.pressure.title} text={formulaText('pressure')} />}>
          <PressureChart points={pressure} width={chartWidth} />
        </Card>
      ) : null}

      {glucose.length ? (
        <Card title="Глюкоза · оценка" right={<InfoButton title={FORMULAS.glucose.title} text={formulaText('glucose')} />}>
          <DayLineChart points={glucose} width={chartWidth} format={(v) => v.toFixed(1)} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md },
});
