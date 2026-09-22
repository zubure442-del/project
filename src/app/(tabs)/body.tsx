import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { STRESS_ZONE_BOUNDS, TAB_INFO, tabInfoText } from '../../domain';
import { findDay, latestSpo2, trendFor, useTabDay, useVuelo } from '../../state';
import {
  DayBanner,
  Card,
  DayLineChart,
  HeroRing,
  PressureChart,
  Screen,
  SparkTile,
  TileBox,
  TileTitle,
  TileValue,
  TrendInline,
  colors,
  spacing,
} from '../../ui';

/** Плитки стоят по две в ряд; развёрнутая занимает всю ширину. */
const COLUMNS = 2;
const HERO_RING = 150;
/** Плавное перестроение сетки при развороте. */
const EXPAND_MS = 220;

const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));

export default function BodyTab() {
  const { state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner } = useTabDay();
  const [open, setOpen] = useState<string | null>(null);
  const still = useReducedMotion();
  const day = findDay(state.days, picked);
  const points = day?.summaryPoints ?? [];
  const tileWidth = (width - spacing.md * 2 - spacing.sm) / COLUMNS;
  const fullWidth = width - spacing.md * 2;

  const hrv = points.filter((p) => p.hrv !== null).map((p) => ({ m: p.m, v: p.hrv as number }));
  const glucose = points.filter((p) => p.glucose !== null).map((p) => ({ m: p.m, v: p.glucose as number }));
  const pressure = points
    .filter((p) => p.systolic !== null && p.diastolic !== null)
    .map((p) => ({ m: p.m, sys: p.systolic as number, dia: p.diastolic as number }));
  const stress = day?.stress ?? [];
  const spo2 = day?.spo2 ?? [];
  const lastSpo2 = latestSpo2(state.days);
  const spo2Average = spo2.length ? Math.round(spo2.reduce((sum, p) => sum + p.v, 0) / spo2.length) : null;
  const e = day?.estimates;

  // Плитка показывается, только если за день есть ряд: пустой квадрат ничего не говорит.
  const tiles = [
    stress.length >= 2 && {
      key: 'stress',
      title: 'Стресс',
      value: String(round(e?.stress) ?? '—'),
      points: stress,
      fixed: { min: 0, max: 100 },
      guides: STRESS_ZONE_BOUNDS,
    },
    spo2.length >= 2 && {
      key: 'spo2',
      title: 'Кислород',
      value: String(spo2Average ?? '—'),
      unit: '%',
      points: spo2,
      fixed: { min: 90, max: 100 },
    },
    hrv.length >= 2 && { key: 'hrv', title: 'Вариабельность', value: String(round(e?.hrv) ?? '—'), unit: 'мс', points: hrv },
    pressure.length >= 2 && {
      key: 'bp',
      title: 'Давление',
      value: `${round(e?.systolic) ?? '—'}/${round(e?.diastolic) ?? '—'}`,
      unit: 'мм рт. ст.',
      points: pressure.map((p) => ({ m: p.m, v: p.sys })),
      second: pressure.map((p) => ({ m: p.m, v: p.dia })),
    },
    glucose.length >= 2 && {
      key: 'glucose',
      title: 'Глюкоза',
      value: e?.glucose != null ? e.glucose.toFixed(1) : '—',
      unit: 'ммоль/л',
      points: glucose,
    },
  ].filter((tile): tile is NonNullable<Exclude<typeof tile, false>> => Boolean(tile));

  const toggle = (key: string) => {
    void Haptics.selectionAsync();
    setOpen((current) => (current === key ? null : key));
  };

  return (
    <Screen
      info={{ title: TAB_INFO.organism.title, text: tabInfoText('organism') }}
      title="Организм"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.state ?? null} size={HERO_RING} />
        <View style={styles.heroSide}>
          <TrendInline trend={trendFor(state, 'state', picked)} />
        </View>
      </View>

      {/* Плитки со спарклайнами; нажатие разворачивает плитку в полный график с осями. */}
      {tiles.length ? (
        <View style={styles.grid}>
          {tiles.map((tile) => {
            const expanded = open === tile.key;
            const second = 'second' in tile ? tile.second : undefined;
            return (
              <Animated.View key={tile.key} layout={still ? undefined : LinearTransition.duration(EXPAND_MS)}>
                <Pressable
                  onPress={() => toggle(tile.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${tile.title}: ${expanded ? 'свернуть' : 'развернуть график'}`}
                  style={({ pressed }) => (pressed ? styles.pressed : undefined)}
                >
                  {expanded ? (
                    <TileBox width={fullWidth}>
                      <View style={styles.headRow}>
                        <TileTitle>{tile.title}</TileTitle>
                        <Text style={styles.collapse}>Свернуть</Text>
                      </View>
                      {second ? (
                        <PressureChart
                          points={tile.points.map((p, i) => ({ m: p.m, sys: p.v, dia: second[i]?.v ?? p.v }))}
                          width={fullWidth - spacing.md * 2}
                        />
                      ) : (
                        <DayLineChart
                          points={tile.points}
                          width={fullWidth - spacing.md * 2}
                          unit={'unit' in tile ? tile.unit : undefined}
                          fixed={'fixed' in tile ? tile.fixed : undefined}
                          guides={'guides' in tile ? tile.guides : undefined}
                        />
                      )}
                      <TileValue value={tile.value} unit={'unit' in tile ? tile.unit : undefined} />
                    </TileBox>
                  ) : (
                    <SparkTile
                      title={tile.title}
                      value={tile.value}
                      unit={'unit' in tile ? tile.unit : undefined}
                      points={tile.points}
                      second={second}
                      width={tileWidth}
                    />
                  )}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      ) : null}

      {!spo2.length && lastSpo2 ? (
        <Card>
          <Text style={styles.line}>
            Кислород · последний замер {lastSpo2.value} % · {lastSpo2.when}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, marginTop: spacing.md },
  heroSide: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapse: { color: colors.textFaint, fontSize: 13 },
  pressed: { opacity: 0.85 },
  line: { color: colors.textMuted, fontSize: 15 },
});
