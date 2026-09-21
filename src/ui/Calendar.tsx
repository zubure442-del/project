import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { dayHasAnything, shortDate, useVuelo } from '../state';
import { Sheet } from './Sheet';
import { colors, radius, spacing } from './theme';

const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const weekday = (date: string) => WEEK_DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Текст про неполный сегодняшний день — тот же, что был на точке с замком в неделе. */
export const TODAY_LOCKED_TEXT =
  'Данных за сегодня ещё нет. Итог появится, когда будут сон, активность и состояние организма. ' +
  'Пока можно изучить статистику за вчера.';

function CalendarIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Rect x={3.5} y={5} width={17} height={15.5} rx={3} stroke={color} strokeWidth={1.8} fill="none" />
      <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function LockGlyph() {
  return (
    <Svg width={12} height={14} viewBox="0 0 12 14">
      <Path d="M3.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke={colors.textFaint} strokeWidth={1.4} fill="none" />
      <Rect x={2} y={6} width={8} height={6.5} rx={1.5} fill={colors.textFaint} />
    </Svg>
  );
}

/**
 * Кнопка-календарь в шапке вкладки: иконка и дата выбранного дня («21 сен»).
 * Лист с полосой из 7 дней; выбор сразу меняет день на всех вкладках.
 */
export function CalendarButton() {
  const { week, dayView: view, selectedDate, selectDay } = useVuelo();
  const [open, setOpen] = useState(false);
  const [lockedNote, setLockedNote] = useState(false);
  const lockedDate = view.todayLocked ? view.today : null;

  const close = () => {
    setOpen(false);
    setLockedNote(false);
  };
  const pick = (date: string) => {
    if (date === lockedDate) {
      setLockedNote(true);
      return;
    }
    void Haptics.selectionAsync();
    selectDay(date);
    close();
  };

  return (
    <>
      <Pressable style={styles.button} onPress={() => setOpen(true)} hitSlop={8} accessibilityLabel="Выбрать день">
        <CalendarIcon color={colors.textMuted} />
        <Text style={styles.buttonText}>{shortDate(selectedDate)}</Text>
      </Pressable>
      <Sheet visible={open} title="Выберите день" onClose={close}>
        <View style={styles.strip}>
          {week.map(({ date, day }) => {
            const locked = date === lockedDate;
            const selected = date === selectedDate && !locked;
            return (
              <Pressable key={date} style={styles.cell} onPress={() => pick(date)} accessibilityLabel={date}>
                <Text style={[styles.weekday, locked && styles.faint]}>{weekday(date)}</Text>
                <View style={[styles.number, selected && styles.numberOn]}>
                  <Text style={[styles.numberText, selected && styles.numberTextOn, locked && styles.faint]}>
                    {Number(date.slice(8, 10))}
                  </Text>
                </View>
                {locked ? (
                  <LockGlyph />
                ) : (
                  <View style={[styles.dot, !dayHasAnything(day) && styles.dotEmpty]} />
                )}
              </Pressable>
            );
          })}
        </View>
        {lockedNote ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>{TODAY_LOCKED_TEXT}</Text>
            {view.lastComplete ? (
              <Pressable style={styles.primary} onPress={() => pick(view.lastComplete as string)}>
                <Text style={styles.primaryText}>Смотреть вчера</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable style={styles.secondary} onPress={() => pick(view.today)}>
            <Text style={styles.secondaryText}>Сегодня</Text>
          </Pressable>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  buttonText: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  cell: { alignItems: 'center', gap: 6, flex: 1 },
  weekday: { color: colors.textMuted, fontSize: 12 },
  number: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  numberOn: { backgroundColor: colors.accent },
  numberText: { color: colors.text, fontSize: 17, fontVariant: ['tabular-nums'] },
  numberTextOn: { color: colors.bg, fontWeight: '600' },
  faint: { color: colors.textFaint },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent, marginVertical: 4.5 },
  dotEmpty: { backgroundColor: 'transparent' },
  note: { marginTop: spacing.md, gap: spacing.md },
  noteText: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  secondary: { marginTop: spacing.md, paddingVertical: 12, alignItems: 'center', borderRadius: radius.card, backgroundColor: colors.track },
  secondaryText: { color: colors.text, fontSize: 16 },
});
