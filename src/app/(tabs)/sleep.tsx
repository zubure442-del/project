import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { TAB_INFO, tabInfoText } from '../../domain';
import { findDay, sleepHrFor, trendFor, useTabDay, useVuelo } from '../../state';
import { DayBanner, Card, HeroRing, Screen, SleepWave, Skeleton, TrendInline, colors, spacing, withAlpha } from '../../ui';

const hhmm = (minutes: number) => `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, '0')} м`;

/** Кольцо в шапке меньше прежнего: справа от него стоит динамика. */
const HERO_RING = 150;

export default function SleepTab() {
  const { state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner } = useTabDay();
  const day = findDay(state.days, picked);
  const sleep = day?.sleep;
  // Пульс во сне — отдельной карточкой: возрастные границы и своя норма по прошлым ночам.
  const sleepHr = sleepHrFor(state, picked);
  const chartWidth = width - spacing.md * 4;
  const deepShare = sleep && sleep.totalMin > 0 ? Math.round((sleep.deepMin / sleep.totalMin) * 100) : null;
  const lightShare = deepShare === null ? null : 100 - deepShare;

  return (
    <Screen
      info={{ title: TAB_INFO.sleep.title, text: tabInfoText('sleep') }}
      title="Сон"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.sleep ?? null} size={HERO_RING} />
        <View style={styles.heroSide}>
          <TrendInline trend={trendFor(state, 'sleep', picked)} />
          {sleep ? <Text style={styles.summary}>{hhmm(sleep.totalMin)}</Text> : null}
        </View>
      </View>

      {day?.sleepSegments.length ? (
        <Card title="Ночь">
          <SleepWave segments={day.sleepSegments} width={chartWidth} />
        </Card>
      ) : null}

      <Card>
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
          </>
        ) : (
          <Skeleton height={72} />
        )}
      </Card>

      {sleepHr ? (
        <Card title="Пульс во сне">
          <Text style={styles.hrValue}>
            {sleepHr.value}
            <Text style={styles.hrUnit}> уд/мин</Text>
          </Text>
          <Text style={[styles.hrText, sleepHr.seeDoctor && styles.hrWarn]}>{sleepHr.text}</Text>
        </Card>
      ) : null}
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
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, marginTop: spacing.md },
  heroSide: { flex: 1, gap: spacing.sm },
  summary: { color: colors.text, fontSize: 17 },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.track },
  deep: { backgroundColor: colors.accent },
  light: { backgroundColor: withAlpha(colors.accent, 0.4) },
  legend: { marginTop: spacing.md, gap: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { color: colors.textMuted, fontSize: 15, flex: 1 },
  legendValue: { color: colors.text, fontSize: 15 },
  hrValue: { color: colors.text, fontSize: 38, fontWeight: '200', fontVariant: ['tabular-nums'] },
  hrUnit: { color: colors.textMuted, fontSize: 15, fontWeight: '400' },
  hrText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  hrWarn: { color: colors.danger },
});
