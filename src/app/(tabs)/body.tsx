import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, STRESS_ZONE_BOUNDS, formulaText } from '../../domain';
import { findDay, heroHint, latestSpo2, missingInputs, useTabDay, useVuelo } from '../../state';
import { DayBanner, Card, DayLineChart, HeroHint, HeroRing, InfoButton, PressureChart, Screen, WeekChart, colors, spacing } from '../../ui';

export default function BodyTab() {
  const { week, state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, shownPhrase, view } = useTabDay();
  const day = findDay(state.days, picked);
  const chartWidth = width - spacing.md * 4;
  const points = day?.summaryPoints ?? [];

  const hrv = points.filter((p) => p.hrv !== null).map((p) => ({ m: p.m, v: p.hrv as number }));
  const glucose = points.filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));
  const pressure = points
    .filter((p) => p.systolic !== null && p.diastolic !== null)
    .map((p) => ({ m: p.m, sys: p.systolic as number, dia: p.diastolic as number }));
  const stress = day?.stress ?? [];
  const spo2 = day?.spo2 ?? [];
  const lastSpo2 = latestSpo2(state.days);

  return (
    <Screen
      title="Организм"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} phrase={shownPhrase} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.state ?? null} />
        {(day?.scores.state ?? null) === null ? <HeroHint text={heroHint('state', picked, view.today)} missing={missingInputs('state', day)} /> : null}
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.state.title} text={formulaText('state')} />}>
        <WeekChart
          days={week}
          value={(d) => d.scores.state}
          selected={picked}
          width={chartWidth}
        />
      </Card>

      {/* Пустые карточки не показываем вовсе: рамка без данных ничего не говорит. */}
      {stress.length ? (
        <Card title="Стресс" right={<InfoButton title={FORMULAS.stress.title} text={formulaText('stress')} />}>
          <DayLineChart points={stress} width={chartWidth} fixed={{ min: 0, max: 100 }} guides={STRESS_ZONE_BOUNDS} />
        </Card>
      ) : null}

      {spo2.length ? (
        <Card title="Кислород" right={<InfoButton title={FORMULAS.state.title} text={formulaText('state')} />}>
          <DayLineChart points={spo2} width={chartWidth} unit="%" fixed={{ min: 90, max: 100 }} />
        </Card>
      ) : lastSpo2 ? (
        <Card>
          <Text style={styles.line}>
            Кислород · последний замер {lastSpo2.value} % · {lastSpo2.when}
          </Text>
        </Card>
      ) : null}

      {hrv.length ? (
        <Card title="Вариабельность" right={<InfoButton title={FORMULAS.hrv.title} text={formulaText('hrv')} />}>
          <DayLineChart points={hrv} width={chartWidth} unit="мс" />
        </Card>
      ) : null}

      {pressure.length ? (
        <Card title="Давление · оценка" right={<InfoButton title={FORMULAS.pressure.title} text={formulaText('pressure')} />}>
          <PressureChart points={pressure} width={chartWidth} />
        </Card>
      ) : null}

      {glucose.length ? (
        <Card title="Глюкоза · оценка" right={<InfoButton title={FORMULAS.glucose.title} text={formulaText('glucose')} />}>
          <DayLineChart points={glucose} width={chartWidth} unit="ммоль/л" />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md },
  line: { color: colors.textMuted, fontSize: 15 },
});
