import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect, Text as SvgText } from 'react-native-svg';
import {
  ACTIVITY_LEVEL_TEXT,
  corridorPosition,
  formatCount,
  pizzaSlices,
  pluralRu,
  weekCalories,
  type WeekActivity,
} from '../domain';
import { PizzaSlice, PizzaStack } from './Pizza';
import { Card } from './Screen';
import { Sheet } from './Sheet';
import { WeekBars } from './WeekBars';
import { colors, spacing, withAlpha } from './theme';

export const CALORIES_WEEK_TITLE = 'Расход активных калорий за неделю';
/** Больше кусков в ряд не рисуем: дальше это каша. Точное число остаётся в подписи. */
export const PIZZA_MAX_SLICES = 12;

const SLICE_FORMS = ['кусок', 'куска', 'кусков'] as const;
const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dayTitle = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEK_DAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
};

/** Ряд целых кусков: дробных не бывает, лишние прячем за «+N». */
function SliceRow({ slices, size = 30 }: { slices: number; size?: number }) {
  const whole = Math.floor(slices);
  const shown = Math.min(PIZZA_MAX_SLICES, whole);
  const hidden = whole - shown;
  if (!whole) return null;
  return (
    <View style={styles.slices}>
      {Array.from({ length: shown }, (_, i) => (
        <PizzaSlice key={i} size={size} />
      ))}
      {hidden > 0 ? <Text style={styles.more}>+{hidden}</Text> : null}
    </View>
  );
}

const GAUGE_HEIGHT = 46;
const GAUGE_BAR = 8;
/** Половина ширины подписи под бегунком: столько места оставляем до края шкалы. */
const GAUGE_LABEL_HALF = 72;

/**
 * Шкала недели «мало — идеально — много» — тот же язык, что у таймлайна «Кофейного окна»:
 * красное по краям, зелёная середина — коридор цели. Бегунок — средний расход за день,
 * под ним подпись оценки. Часть шкалы, где стоит бегунок, яркая, остальные приглушены.
 */
function ActivityGauge({ activity, width }: { activity: WeekActivity; width: number }) {
  const gap = 3;
  const part = (width - gap * 2) / 3;
  const position = corridorPosition(activity.perDay, activity.from, activity.to);
  const zone = activity.level === 'low' ? 0 : activity.level === 'ideal' ? 1 : 2;
  const x = Math.min(width - GAUGE_BAR, Math.max(GAUGE_BAR, position * width));
  const labelX = Math.min(width - GAUGE_LABEL_HALF, Math.max(GAUGE_LABEL_HALF, x));
  const color = activity.level === 'ideal' ? colors.positive : colors.negative;
  const zoneColor = (i: number) =>
    i === 1 ? withAlpha(colors.positive, i === zone ? 1 : 0.3) : withAlpha(colors.negative, i === zone ? 0.85 : 0.25);
  const barY = 6;
  return (
    <View pointerEvents="none" style={styles.gauge}>
      <Svg width={width} height={GAUGE_HEIGHT}>
        {[0, 1, 2].map((i) => (
          <Rect key={i} x={i * (part + gap)} y={barY} width={part} height={GAUGE_BAR} rx={GAUGE_BAR / 2} fill={zoneColor(i)} />
        ))}
        <Circle cx={x} cy={barY + GAUGE_BAR / 2} r={8} fill={colors.text} stroke={colors.card} strokeWidth={3} />
        <SvgText x={labelX} y={GAUGE_HEIGHT - 6} fill={color} fontSize={13} fontWeight="500" textAnchor="middle">
          {ACTIVITY_LEVEL_TEXT[activity.level]}
        </SvgText>
      </Svg>
    </View>
  );
}

/**
 * «Расход активных калорий за неделю» одним блоком: слева пиццы (куски складываются в целые
 * пиццы), справа сумма и та же сумма в кусках; ниже — шкала недели с оценкой по цели.
 * По нажатию — лист с расходом по дням. Мера грубая и не медицинская: один кусок —
 * ровно `KCAL_PER_PIZZA_SLICE` ккал, на экране это число не пишем.
 */
export function CaloriesWeekCard({
  days,
  width,
  activity,
}: {
  days: { date: string; value: number | null }[];
  width: number;
  /** Оценка недели по коридору от базового обмена и цели; null — нет биометрии, цели или данных. */
  activity?: WeekActivity | null;
}) {
  const [open, setOpen] = useState(false);
  const total = weekCalories(days.map((d) => d.value));
  const slices = total === null ? 0 : Math.floor(pizzaSlices(total));

  return (
    <>
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen(true);
        }}
        accessibilityRole="button"
        style={({ pressed }) => (pressed ? styles.pressed : undefined)}
      >
        <Card title={CALORIES_WEEK_TITLE} right={<Text style={styles.chevron}>›</Text>}>
          <View style={styles.hero}>
            {total !== null ? <PizzaStack slices={slices} /> : null}
            <View style={styles.heroText}>
              <Text style={styles.total} numberOfLines={1} adjustsFontSizeToFit>
                {total === null ? '—' : formatCount(total)}
                <Text style={styles.unit}> ккал</Text>
              </Text>
              {total !== null ? (
                <Text style={styles.caption}>
                  {slices > 0 ? `${slices} ${pluralRu(slices, SLICE_FORMS)} пиццы` : 'Меньше куска пиццы'}
                </Text>
              ) : null}
            </View>
          </View>
          {activity ? <ActivityGauge activity={activity} width={width} /> : null}
        </Card>
      </Pressable>

      <Sheet visible={open} title="Расход по дням" onClose={() => setOpen(false)}>
        <WeekBars days={days} width={width} />
        <View style={styles.rows}>
          {days.map((d) => (
            <View key={d.date} style={styles.row}>
              <Text style={styles.rowDay}>{dayTitle(d.date)}</Text>
              {d.value === null ? (
                <Text style={styles.rowEmpty}>нет данных</Text>
              ) : (
                <>
                  <View style={styles.rowSlices}>
                    <SliceRow slices={pizzaSlices(d.value)} size={16} />
                  </View>
                  <Text style={styles.rowValue}>{formatCount(d.value)} ккал</Text>
                </>
              )}
            </View>
          ))}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  chevron: { color: colors.textFaint, fontSize: 22, lineHeight: 24 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  heroText: { flex: 1 },
  total: { color: colors.text, fontSize: 38, fontWeight: '200', fontVariant: ['tabular-nums'] },
  unit: { color: colors.textMuted, fontSize: 15, fontWeight: '400' },
  caption: { color: colors.textMuted, fontSize: 14, marginTop: -2 },
  gauge: { marginTop: spacing.md },
  slices: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  more: { color: colors.textMuted, fontSize: 13, marginLeft: 2 },
  rows: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  rowDay: { color: colors.text, fontSize: 15, width: 96 },
  rowSlices: { flex: 1 },
  rowValue: { color: colors.textMuted, fontSize: 14, fontVariant: ['tabular-nums'] },
  rowEmpty: { color: colors.textFaint, fontSize: 14, flex: 1, textAlign: 'right' },
});
