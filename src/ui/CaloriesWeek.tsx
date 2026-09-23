import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ACTIVITY_LEVEL_TEXT, formatCount, pizzaSlices, pluralRu, weekCalories, type ActivityLevel } from '../domain';
import { PizzaSlice } from './Pizza';
import { Card } from './Screen';
import { Sheet } from './Sheet';
import { WeekBars } from './WeekBars';
import { colors, spacing } from './theme';

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

/**
 * «Расход активных калорий за неделю»: сумма за 7 дней и то же число в кусках пиццы —
 * чтобы было понятно, сколько это. По нажатию — лист с расходом по дням.
 * Мера грубая и не медицинская: один кусок — ровно `KCAL_PER_PIZZA_SLICE` ккал.
 */
export function CaloriesWeekCard({
  days,
  width,
  level,
}: {
  days: { date: string; value: number | null }[];
  width: number;
  /** Оценка недели по коридору от базового обмена и цели; null — нет биометрии, цели или данных. */
  level?: ActivityLevel | null;
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
          {/* Справа от числа, по нижнему краю — как неделя смотрится относительно цели. */}
          <View style={styles.totalRow}>
            <Text style={styles.total}>
              {total === null ? '—' : formatCount(total)}
              <Text style={styles.unit}> ккал</Text>
            </Text>
            {level ? (
              <Text style={[styles.level, level === 'ideal' ? styles.levelGood : styles.levelBad]}>
                {ACTIVITY_LEVEL_TEXT[level]}
              </Text>
            ) : null}
          </View>
          <SliceRow slices={slices} />
          {slices > 0 ? (
            <Text style={styles.caption}>
              {slices} {pluralRu(slices, SLICE_FORMS)} пиццы
            </Text>
          ) : null}
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
  totalRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  total: { color: colors.text, fontSize: 38, fontWeight: '200', fontVariant: ['tabular-nums'] },
  level: { fontSize: 14, fontWeight: '500', marginBottom: 6 },
  levelGood: { color: colors.positive },
  levelBad: { color: colors.negative },
  unit: { color: colors.textMuted, fontSize: 15 },
  slices: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  more: { color: colors.textMuted, fontSize: 13, marginLeft: 2 },
  caption: { color: colors.textFaint, fontSize: 12, marginTop: spacing.sm },
  rows: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  rowDay: { color: colors.text, fontSize: 15, width: 96 },
  rowSlices: { flex: 1 },
  rowValue: { color: colors.textMuted, fontSize: 14, fontVariant: ['tabular-nums'] },
  rowEmpty: { color: colors.textFaint, fontSize: 14, flex: 1, textAlign: 'right' },
});
