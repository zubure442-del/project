import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TREND_MIN_DAYS, trendPhrase, type Trend } from '../domain';
import { Card } from './Screen';
import { colors, radius, spacing, withAlpha } from './theme';

export const TREND_TITLE = 'Динамика за неделю';
/** Пока второй недели нет, сравнивать не с чем — говорим об этом прямо. */
export const TREND_WAIT_TEXT = 'Сравним с прошлой неделей, когда наберётся вторая неделя данных';
export const TREND_EMPTY_TEXT = 'Данных за неделю пока нет';
/** Шкала полосок: оценки всегда 0–100. */
const SCALE = 100;

/** Стрелка направления: вверх — рост, вниз — падение, черта — без изменений. */
function TrendArrow({ percent, size = 26 }: { percent: number; size?: number }) {
  const color = percent > 0 ? colors.accent : percent < 0 ? colors.textMuted : colors.textFaint;
  const p = { stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {percent === 0 ? (
        <Path {...p} d="M4 12h16" />
      ) : percent > 0 ? (
        <Path {...p} d="M5 17 11 10l3.5 3.5L20 7M20 7h-4.5M20 7v4.5" />
      ) : (
        <Path {...p} d="M5 7l6 7 3.5-3.5L20 17M20 17h-4.5M20 17v-4.5" />
      )}
    </Svg>
  );
}

/** Одна полоска сравнения: подпись, шкала и значение. */
function CompareBar({ label, value, strong }: { label: string; value: number | null; strong: boolean }) {
  const share = value === null ? 0 : Math.max(0.02, Math.min(1, value / SCALE));
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${share * 100}%`, backgroundColor: strong ? colors.accent : withAlpha(colors.accent, 0.35) }]}
        />
      </View>
      <Text style={[styles.barValue, !strong && styles.barValueFaint]}>{value === null ? '—' : Math.round(value)}</Text>
    </View>
  );
}

/**
 * «Динамика за неделю» вместо прежнего недельного графика: насколько показатель вырос
 * или упал по сравнению с предыдущей неделей, плюс две полоски со средними.
 * Сегодняшний незавершённый день в сравнение не входит (см. `weekTrend`).
 */
export function WeekTrendCard({ trend }: { trend: Trend }) {
  const { percent, current, previous } = trend;
  const sign = percent === null ? '' : percent > 0 ? '+' : '';

  return (
    <Card title={TREND_TITLE}>
      {percent === null ? (
        <View style={styles.wait}>
          {current === null ? (
            <Text style={styles.waitText}>{TREND_EMPTY_TEXT}</Text>
          ) : (
            <>
              <Text style={styles.average}>
                {Math.round(current)}
                <Text style={styles.averageUnit}> в среднем за неделю</Text>
              </Text>
              <Text style={styles.waitText}>
                {trend.currentDays < TREND_MIN_DAYS ? 'Пока мало дней с данными для сравнения' : TREND_WAIT_TEXT}
              </Text>
            </>
          )}
        </View>
      ) : (
        <>
          <View style={styles.head}>
            <View style={[styles.badge, percent > 0 && styles.badgeUp]}>
              <TrendArrow percent={percent} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.percent}>
                {sign}
                {percent}
                <Text style={styles.percentSign}> %</Text>
              </Text>
              <Text style={styles.phrase}>{trendPhrase(percent)}</Text>
            </View>
          </View>
          <View style={styles.bars}>
            <CompareBar label="Эта неделя" value={current} strong />
            <CompareBar label="Прошлая" value={previous} strong={false} />
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeUp: { backgroundColor: withAlpha(colors.accent, 0.14) },
  headText: { flex: 1 },
  percent: { color: colors.text, fontSize: 40, fontWeight: '200', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  percentSign: { color: colors.textMuted, fontSize: 20, fontWeight: '300' },
  phrase: { color: colors.textMuted, fontSize: 14, marginTop: -2 },
  bars: { marginTop: spacing.md, gap: spacing.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { color: colors.textMuted, fontSize: 13, width: 84 },
  track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  barValue: { color: colors.text, fontSize: 15, width: 30, textAlign: 'right', fontVariant: ['tabular-nums'] },
  barValueFaint: { color: colors.textMuted },
  wait: { gap: spacing.xs },
  average: { color: colors.text, fontSize: 34, fontWeight: '200', fontVariant: ['tabular-nums'] },
  averageUnit: { color: colors.textMuted, fontSize: 15, fontWeight: '400' },
  waitText: { color: colors.textFaint, fontSize: 13, lineHeight: 18 },
});
