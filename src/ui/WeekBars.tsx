import { View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { colors } from './theme';

const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dayLabel = (date: string) => WEEK_DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

const HEIGHT = 72;
const BAR_WIDTH = 6;
const LABEL_SPACE = 18;

/**
 * Семь тонких столбиков по дням, названия дней под ними. Значения не подписаны,
 * график не нажимается. День без значения — без столбика.
 */
export function WeekBars({ days, width }: { days: { date: string; value: number | null }[]; width: number }) {
  const max = Math.max(1, ...days.map((d) => d.value ?? 0));
  const step = width / Math.max(1, days.length);
  const plot = HEIGHT - LABEL_SPACE;
  return (
    <View pointerEvents="none">
      <Svg width={width} height={HEIGHT}>
        {days.map((d, i) => {
          const cx = step * (i + 0.5);
          const h = d.value === null ? 0 : Math.max(2, (d.value / max) * plot);
          return (
            <Rect
              key={d.date}
              x={cx - BAR_WIDTH / 2}
              y={plot - h}
              width={BAR_WIDTH}
              height={h}
              rx={BAR_WIDTH / 2}
              fill={colors.accent}
              opacity={d.value === null ? 0 : 1}
            />
          );
        })}
        {days.map((d, i) => (
          <SvgText key={`l${d.date}`} x={step * (i + 0.5)} y={HEIGHT - 3} fill={colors.textFaint} fontSize={12} textAnchor="middle">
            {dayLabel(d.date)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
