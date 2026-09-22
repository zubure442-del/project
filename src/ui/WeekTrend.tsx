import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TREND_MAX_PERCENT, trendPhrase, type Trend } from '../domain';
import { Card } from './Screen';
import { colors, spacing, withAlpha } from './theme';

export const TREND_TITLE = 'Динамика за неделю';
/** Сравнивать нечего: мало дней с данными или слишком низкая база. */
export const TREND_EMPTY_TEXT = 'Пока мало данных для сравнения';

/** Цвет роста и падения: единственное место, где в приложении есть зелёный и красный. */
export const trendColor = (percent: number): string =>
  percent > 0 ? colors.positive : percent < 0 ? colors.negative : colors.textMuted;

/** Стрелка направления: вверх — рост, вниз — падение, черта — без изменений. */
function TrendArrow({ percent, size = 26 }: { percent: number; size?: number }) {
  const p = {
    stroke: trendColor(percent),
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
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

/**
 * «Динамика за неделю»: только процент и одна строка, на какой он базе. Чисел по дням нет —
 * они ничего не добавляют. Карточка видна всегда: пока второй недели нет, сравнение идёт
 * с личной нормой (`weekTrend`), а совсем без данных остаётся заголовок.
 */
export function WeekTrendCard({ trend }: { trend: Trend }) {
  const { percent, capped } = trend;
  if (percent === null) {
    return (
      <Card title={TREND_TITLE}>
        <Text style={styles.waitText}>{TREND_EMPTY_TEXT}</Text>
      </Card>
    );
  }
  const color = trendColor(percent);
  const value = capped ? `более ${TREND_MAX_PERCENT} %` : `${percent > 0 ? '+' : ''}${percent} %`;

  return (
    <Card title={TREND_TITLE}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: withAlpha(color, 0.14) }]}>
          <TrendArrow percent={percent} />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.percent, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {value}
          </Text>
          <Text style={styles.phrase}>{trendPhrase(percent, trend.mode)}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  percent: { fontSize: 40, fontWeight: '200', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  phrase: { color: colors.textMuted, fontSize: 14, marginTop: -2 },
  waitText: { color: colors.textFaint, fontSize: 14 },
});
