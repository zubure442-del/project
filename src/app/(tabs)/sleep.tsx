import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, formulaText } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, HeroRing, InfoButton, Screen, SleepWave, Skeleton, WeekChart, colors, spacing, withAlpha } from '../../ui';

const hhmm = (minutes: number) => `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, '0')} м`;

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
      onSync={sync}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.sleep ?? null} />
        {sleep ? <Text style={styles.summary}>{hhmm(sleep.totalMin)}</Text> : null}
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.sleep.title} text={formulaText('sleep')} />}>
        <WeekChart days={week} value={(d) => d.scores.sleep} selected={picked} onSelect={setPicked} width={chartWidth} />
      </Card>

      {day?.sleepSegments.length ? (
        <Card title="Ночь">
          <SleepWave segments={day.sleepSegments} width={chartWidth} />
        </Card>
      ) : null}

      <Card right={<InfoButton title={FORMULAS.deepShare.title} text={formulaText('deepShare')} />}>
        {sleep && deepShare !== null ? (
          <>
            <View style={styles.bar}>
              <View style={[styles.deep, { flex: deepShare }]} />
              <View style={[styles.light, { flex: lightShare ?? 0 }]} />
            </View>
            <View style={styles.legend}>
              <Legend color={colors.accent} label="Глубокий" value={`${hhmm(sleep.deepMin)} · ${deepShare} %`} />
              <Legend color={withAlpha(colors.accent, 0.4)} label="Лёгкий" value={`${hhmm(sleep.lightMin)} · ${lightShare} %`} />
            </View>
            {day?.restingHrSource === 'night' && day.restingHr ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>Пульс во сне {day.restingHr}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Skeleton height={72} />
        )}
      </Card>
    </Screen>
  );
}

const Legend = ({ color, label, value }: { color: string; label: string; value: string }) => (
  <View style={styles.legendRow}>
    <View style={[styles.dot, { backgroundColor: color }]} />
    <Text style={styles.legendLabel}>{label}</Text>
    <Text style={styles.legendValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
  summary: { color: colors.textMuted, fontSize: 16 },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.track },
  deep: { backgroundColor: colors.accent },
  light: { backgroundColor: withAlpha(colors.accent, 0.4) },
  legend: { marginTop: spacing.md, gap: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { color: colors.textMuted, fontSize: 15, flex: 1 },
  legendValue: { color: colors.text, fontSize: 15 },
  chip: { alignSelf: 'flex-start', marginTop: spacing.md, backgroundColor: colors.track, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { color: colors.textMuted, fontSize: 13 },
});
