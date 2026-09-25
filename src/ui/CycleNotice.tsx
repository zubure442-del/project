import { StyleSheet, Text, View } from 'react-native';
import { wallClock } from '../codec';
import { PAST_DAY_NOTE, distanceMeters, formatCount, formatDistance } from '../domain';
import type { DaySnapshot } from '../storage';
import { Ring } from './Ring';
import { Card } from './Screen';
import { TipGlyph } from './TipIcons';
import { colors, spacing } from './theme';

/** «23:10» по кольцевой метке (настенное время). */
const clockOf = (ts: number) => {
  const w = wallClock(ts);
  return `${w.hour}:${String(w.minute).padStart(2, '0')}`;
};

export type CycleNoticeKind = 'offBody' | 'ringOff' | 'timeout';

/** Тексты уведомления. Без чисел про здоровье: только что случилось и когда появится итог. */
export function cycleNoticeText(kind: CycleNoticeKind, gap: { from: number; to: number | null } | null) {
  if (kind === 'ringOff') {
    return {
      title: 'Кольцо не на руке',
      text: `${gap ? `Замеров нет с ${clockOf(gap.from)}. ` : ''}Наденьте кольцо — данные начнут копиться снова.`,
    };
  }
  if (kind === 'offBody') {
    return {
      title: 'Данных за этот период нет',
      text:
        (gap && gap.to !== null ? `С ${clockOf(gap.from)} до ${clockOf(gap.to)} кольцо было снято. ` : 'Кольцо было снято. ') +
        'Сна и состояния организма за это время нет, итог появится после следующего сна. Пока считаем активность.',
    };
  }
  return {
    title: 'Больше суток без сна',
    text: 'Итог появится после сна. Пока считаем активность.',
  };
}

/**
 * Уведомление на «Сегодня», когда у текущего цикла нет итога не из-за нехватки дней,
 * а из-за пропуска: кольцо снимали дольше 3 часов, оно снято сейчас или человек не спит больше 28 часов.
 */
export function CycleNotice({ kind, gap }: { kind: CycleNoticeKind; gap: { from: number; to: number | null } | null }) {
  const { title, text } = cycleNoticeText(kind, gap);
  return (
    <View style={styles.notice}>
      <TipGlyph name="info" size={48} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

/**
 * Исключение ради пользы: без итога показываем только то, что копится само, —
 * индекс активности цикла и шаги за календарные сутки.
 */
export function ActivityNow({ activity, steps }: { activity: number | null; steps: number | null }) {
  return (
    <View style={styles.activity}>
      <Ring value={activity} size={96} thickness={7}>
        <Text style={styles.ringValue}>{activity ?? '—'}</Text>
      </Ring>
      <View style={styles.activitySide}>
        <Text style={styles.label}>Активность</Text>
        <Text style={styles.steps}>{formatCount(steps ?? 0)} шагов сегодня</Text>
      </View>
    </View>
  );
}

const hhmm = (minutes: number) => `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, '0')} м`;

/**
 * Прошлый день: только устойчивые календарные числа — шаги, дистанция, калории и сон.
 * Итог и индексы считаются по циклам и на прошлых датах не показываются.
 */
export function DayFacts({ day, heightCm }: { day: DaySnapshot; heightCm: number | null }) {
  const rows = [
    day.steps !== null && { label: 'Шаги', value: formatCount(day.steps) },
    day.steps !== null && heightCm !== null && { label: 'Дистанция', value: formatDistance(distanceMeters(day.steps, heightCm)) },
    day.calories != null && { label: 'Активные калории', value: `${formatCount(day.calories)} ккал` },
    day.sleep && { label: 'Сон', value: hhmm(day.sleep.totalMin) },
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  return (
    <>
      {/* Почему здесь нет итога: он считается по циклам, а прошлый день — это только замеры. */}
      <Text style={styles.pastNote}>{PAST_DAY_NOTE}</Text>
      <Card>
        {rows.map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.rowValue}>{row.value}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  notice: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  title: { color: colors.text, fontSize: 20, fontWeight: '500', textAlign: 'center' },
  text: { color: colors.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  activitySide: { flex: 1, gap: spacing.xs },
  ringValue: { color: colors.text, fontSize: 30, fontWeight: '200' },
  label: { color: colors.textMuted, fontSize: 15 },
  steps: { color: colors.text, fontSize: 17 },
  pastNote: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: spacing.xs },
  rowLabel: { color: colors.textMuted, fontSize: 15 },
  rowValue: { color: colors.text, fontSize: 22, fontWeight: '200', fontVariant: ['tabular-nums'] },
});
