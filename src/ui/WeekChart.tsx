import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { MAX_DAY_SPACING, hasData, placeLabels, visibleDays } from '../domain';
import type { DaySnapshot } from '../storage';
import { colors, withAlpha } from './theme';

const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dayLabel = (date: string) => WEEK_DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Геометрия: место сверху под подписи значений, снизу — под дни недели. */
const HEIGHT = 116;
const TOP = 34;
const BOTTOM = HEIGHT - 22;

interface WeekChartProps {
  days: { date: string; day: DaySnapshot | null }[];
  value: (day: DaySnapshot) => number | null;
  /** Выбранный в календаре день: его точка крупнее. Сам график день не выбирает. */
  selected: string;
  width: number;
}

/**
 * Неделя: линия с разрывами на днях без данных, числа над всеми точками,
 * дни недели под осью. Не нажимается — день выбирается календарём в шапке.
 */
export function WeekChart({ days, value, selected, width }: WeekChartProps) {
  const shown = visibleDays(days);
  if (!shown.length) return null;
  const points = shown.map(({ date, day }) => ({ date, v: hasData(day) ? value(day) : null }));
  const known = points.map((p) => p.v).filter((v): v is number => v !== null);
  const min = known.length ? Math.min(...known) : 0;
  const max = known.length ? Math.max(...known) : 100;
  const span = Math.max(1, max - min);
  // Ширина шага ограничена: два дня стоят по центру, семь занимают всю ширину.
  const step = Math.min(MAX_DAY_SPACING, width / Math.max(1, shown.length));
  const left = (width - step * shown.length) / 2;
  const x = (i: number) => left + step * (i + 0.5);
  const y = (v: number) => BOTTOM - ((v - min) / span) * (BOTTOM - TOP);

  // Линия рвётся на днях без данных: дорисовывать ноль было бы враньём.
  const segments: { i: number; v: number }[][] = [[]];
  points.forEach((p, i) => {
    if (p.v === null) segments.push([]);
    else segments[segments.length - 1].push({ i, v: p.v });
  });

  const labelled = points
    .map((p, i) => ({ i, p }))
    .filter((e): e is { i: number; p: { date: string; v: number } } => e.p.v !== null);
  const bases = placeLabels(
    labelled.map(({ i, p }) => ({ x: x(i), y: y(p.v), text: String(Math.round(p.v)), selected: p.date === selected })),
    { top: 0, bottom: HEIGHT - 16 },
  );

  return (
    <View pointerEvents="none">
      <Svg width={width} height={HEIGHT}>
        {[TOP, BOTTOM].map((gy) => (
          <Line key={gy} x1={0} x2={width} y1={gy} y2={gy} stroke={colors.track} strokeWidth={1} />
        ))}
        {segments
          .filter((seg) => seg.length > 1)
          .map((seg, k) => (
            <Path
              key={k}
              d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        {labelled.map(({ i, p }) => {
          const on = p.date === selected;
          return (
            <Circle
              key={p.date}
              cx={x(i)}
              cy={y(p.v)}
              r={on ? 5.5 : 3}
              fill={on ? colors.accent : withAlpha(colors.accent, 0.55)}
              stroke={on ? colors.bg : undefined}
              strokeWidth={on ? 1.5 : 0}
            />
          );
        })}
        {labelled.map(({ i, p }, k) => {
          const on = p.date === selected;
          return (
            <SvgText
              key={`v${p.date}`}
              x={x(i)}
              y={bases[k]}
              fill={on ? colors.text : colors.textFaint}
              fontSize={on ? 13 : 11}
              fontWeight={on ? '600' : '400'}
              textAnchor="middle"
            >
              {Math.round(p.v)}
            </SvgText>
          );
        })}
        {points.map((p, i) => (
          <SvgText
            key={`l${p.date}`}
            x={x(i)}
            y={HEIGHT - 4}
            fill={p.date === selected ? colors.textMuted : colors.textFaint}
            fontSize={12}
            textAnchor="middle"
          >
            {dayLabel(p.date)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
