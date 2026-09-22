import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KCAL_PER_PIZZA_SLICE, formatCount, pizzaSlices, pluralRu, weekCalories } from '../domain';
import { PizzaSlice } from './Pizza';
import { Card } from './Screen';
import { Sheet } from './Sheet';
import { WeekBars } from './WeekBars';
import { colors, spacing } from './theme';

export const CALORIES_WEEK_TITLE = 'Расход активных калорий за неделю';
/** Больше кусков в ряд не рисуем: дальше это каша. Точное число остаётся в подписи. */
export const PIZZA_MAX_SLICES = 12;
/** Хвостик меньше этого не рисуем отдельным куском. */
const PIZZA_MIN_TAIL = 0.12;

const SLICE_FORMS = ['кусок', 'куска', 'кусков'] as const;
const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dayTitle = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEK_DAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
};

/** Ряд кусков: целые закрашены, последний — на сколько хватило калорий. */
function SliceRow({ slices, size = 30 }: { slices: number; size?: number }) {
  const full = Math.min(PIZZA_MAX_SLICES, Math.floor(slices));
  const tail = slices - Math.floor(slices);
  const shown = [...Array<number>(full).fill(1)];
  if (full < PIZZA_MAX_SLICES && tail >= PIZZA_MIN_TAIL) shown.push(tail);
  const hidden = Math.max(0, Math.floor(slices) - full);
  return (
    <View style={styles.slices}>
      {shown.map((fill, i) => (
        <PizzaSlice key={i} size={size} fill={fill} />
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
export function CaloriesWeekCard({ days, width }: { days: { date: string; value: number | null }[]; width: number }) {
  const [open, setOpen] = useState(false);
  const total = weekCalories(days.map((d) => d.value));
  const slices = total === null ? 0 : pizzaSlices(total);
  const rounded = Math.round(slices);

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
          <Text style={styles.total}>
            {total === null ? '—' : formatCount(total)}
            <Text style={styles.unit}> ккал</Text>
          </Text>
          <SliceRow slices={slices} />
          <Text style={styles.caption}>
            ≈ {rounded} {pluralRu(rounded, SLICE_FORMS)} пиццы · один кусок ≈ {formatCount(KCAL_PER_PIZZA_SLICE)} ккал
          </Text>
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
        <Text style={styles.note}>
          Один кусок пиццы — примерно {formatCount(KCAL_PER_PIZZA_SLICE)} ккал. Считаем только активные калории,
          без обычного расхода в покое.
        </Text>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  chevron: { color: colors.textFaint, fontSize: 22, lineHeight: 24 },
  total: { color: colors.text, fontSize: 38, fontWeight: '200', fontVariant: ['tabular-nums'] },
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
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
});
