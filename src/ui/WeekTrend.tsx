import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TREND_MAX_PERCENT, trendPhrase, type Trend } from '../domain';
import { colors, spacing } from './theme';

/** Сравнивать нечего: мало дней с данными или слишком низкая база. */
export const TREND_EMPTY_TEXT = 'Пока мало данных';

/** Цвет роста и падения: единственное место, где в приложении есть зелёный и красный. */
export const trendColor = (percent: number): string =>
  percent > 0 ? colors.positive : percent < 0 ? colors.negative : colors.textMuted;

/** Стрелка направления: вверх — рост, вниз — падение, черта — без изменений. */
export function TrendArrow({ percent, size = 20 }: { percent: number; size?: number }) {
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
 * Динамика рядом с главным показателем вкладки: стрелка, процент и одна короткая строка,
 * с чем сравниваем («ниже вашей нормы», «выше прошлой недели»). Отдельной карточки внизу нет.
 */
export function TrendInline({ trend }: { trend: Trend }) {
  const { percent, capped } = trend;
  if (percent === null) return <Text style={styles.empty}>{TREND_EMPTY_TEXT}</Text>;
  const color = trendColor(percent);
  const value = capped ? `более ${TREND_MAX_PERCENT} %` : `${percent > 0 ? '+' : ''}${percent} %`;

  return (
    <View>
      <View style={styles.row}>
        <TrendArrow percent={percent} />
        <Text style={[styles.percent, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {value}
        </Text>
      </View>
      <Text style={styles.phrase}>{trendPhrase(percent, trend.mode)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  percent: { fontSize: 30, fontWeight: '200', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  phrase: { color: colors.textMuted, fontSize: 13, marginTop: -2 },
  empty: { color: colors.textFaint, fontSize: 13 },
});
