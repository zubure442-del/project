import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { TAB_INFO, tabInfoText } from '../../domain';
import { findDay, latestSpo2, trendFor, useTabDay, useVuelo } from '../../state';
import { DayBanner, Card, HeroRing, Screen, SparkTile, WeekTrendCard, colors, spacing } from '../../ui';

/** Плитки стоят по две в ряд. */
const COLUMNS = 2;

const round = (v: number | null) => (v === null ? null : Math.round(v));

export default function BodyTab() {
  const { state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner } = useTabDay();
  const day = findDay(state.days, picked);
  const points = day?.summaryPoints ?? [];
  const tileWidth = (width - spacing.md * 2 - spacing.sm) / COLUMNS;

  const hrv = points.filter((p) => p.hrv !== null).map((p) => ({ m: p.m, v: p.hrv as number }));
  const glucose = points.filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));
  const systolic = points.filter((p) => p.systolic !== null).map((p) => ({ m: p.m, v: p.systolic as number }));
  const diastolic = points.filter((p) => p.diastolic !== null).map((p) => ({ m: p.m, v: p.diastolic as number }));
  const stress = day?.stress ?? [];
  const spo2 = day?.spo2 ?? [];
  const lastSpo2 = latestSpo2(state.days);
  const spo2Average = spo2.length ? Math.round(spo2.reduce((sum, p) => sum + p.v, 0) / spo2.length) : null;
  const estimates = day?.estimates;

  // Плитка показывается, только если за день есть ряд: пустой квадрат ничего не говорит.
  const tiles = [
    stress.length >= 2 && { key: 'stress', title: 'Стресс', value: String(round(estimates?.stress ?? null) ?? '—'), points: stress },
    spo2.length >= 2 && { key: 'spo2', title: 'Кислород', value: String(spo2Average ?? '—'), unit: '%', points: spo2 },
    hrv.length >= 2 && { key: 'hrv', title: 'Вариабельность', value: String(round(estimates?.hrv ?? null) ?? '—'), unit: 'мс', points: hrv },
    systolic.length >= 2 && {
      key: 'bp',
      title: 'Давление',
      value: `${round(estimates?.systolic ?? null) ?? '—'}/${round(estimates?.diastolic ?? null) ?? '—'}`,
      points: systolic,
      second: diastolic,
    },
    glucose.length >= 2 && {
      key: 'glucose',
      title: 'Глюкоза',
      value: estimates?.glucose != null ? estimates.glucose.toFixed(1) : '—',
      unit: 'ммоль/л',
      points: glucose,
    },
  ].filter((tile): tile is NonNullable<Exclude<typeof tile, false>> => Boolean(tile));

  return (
    <Screen
      info={{ title: TAB_INFO.organism.title, text: tabInfoText('organism') }}
      title="Организм"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.state ?? null} />
      </View>

      {/* Пять показателей замера — компактными плитками со спарклайнами, по две в ряд. */}
      {tiles.length ? (
        <View style={styles.grid}>
          {tiles.map((tile) => (
            <SparkTile
              key={tile.key}
              title={tile.title}
              value={tile.value}
              unit={'unit' in tile ? tile.unit : undefined}
              points={tile.points}
              second={'second' in tile ? tile.second : undefined}
              width={tileWidth}
            />
          ))}
        </View>
      ) : null}

      {!spo2.length && lastSpo2 ? (
        <Card>
          <Text style={styles.line}>
            Кислород · последний замер {lastSpo2.value} % · {lastSpo2.when}
          </Text>
        </Card>
      ) : null}

      <WeekTrendCard trend={trendFor(state, 'state', picked)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  line: { color: colors.textMuted, fontSize: 15 },
});
