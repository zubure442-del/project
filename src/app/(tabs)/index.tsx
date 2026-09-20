import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ComponentId } from '../../domain';
import { findDay, reportMode, reportTitle, todayKey, useVuelo } from '../../state';
import { COMPONENT_LABEL, Card, Ring, Screen, Stat, WeekStrip, colors, spacing, styles as ui } from '../../ui';

const COMPONENTS: ComponentId[] = ['sleep', 'activity', 'state'];

export default function TodayTab() {
  const { week, report, state, busy, progress, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const day = findDay(state.days, picked);
  const isToday = picked === todayKey();
  const sleep = day?.sleep;

  return (
    <Screen
      title={isToday ? 'Сегодня' : dayTitle(picked)}
      statusText={statusText}
      busy={busy}
      progress={progress}
      battery={state.battery}
      onSync={sync}
      onOpenRing={() => router.push('/ring')}
    >
      <WeekStrip
        days={week}
        metrics={[{ id: 'total', label: 'Итог', value: (d) => d.total }]}
        metricId="total"
        onMetric={() => {}}
        selected={picked}
        onSelect={setPicked}
      />

      <View style={styles.total}>
        <Ring value={day?.total ?? null} size={Math.min(220, width - 130)} thickness={11} glow>
          <Text style={styles.totalValue}>{day?.total ?? '—'}</Text>
          <Text style={styles.totalCaption}>Итог</Text>
        </Ring>
      </View>

      <View style={styles.components}>
        {COMPONENTS.map((id) => (
          <View key={id} style={styles.component}>
            <Ring value={day?.scores[id] ?? null} size={80} thickness={6}>
              <Text style={styles.componentValue}>{day?.scores[id] ?? '—'}</Text>
            </Ring>
            <Text style={styles.componentLabel}>{COMPONENT_LABEL[id]}</Text>
          </View>
        ))}
      </View>

      {isToday && report ? (
        <Card title={reportTitle(reportMode(new Date()))}>
          <Text style={styles.report}>{report.text}</Text>
        </Card>
      ) : null}

      {!day && isToday ? (
        <Card>
          <Text style={styles.report}>Потяните вниз, чтобы получить данные с кольца.</Text>
        </Card>
      ) : null}

      {day ? (
        <Card>
          <View style={ui.statRow}>
            <Stat label="Сон" value={sleep ? `${Math.floor(sleep.totalMin / 60)}ч ${sleep.totalMin % 60}м` : '—'} />
            <Stat label="Шаги" value={day.steps != null ? String(day.steps) : '—'} />
            <Stat
              label={day.restingHrSource === 'night' ? 'Пульс во сне' : 'Мин. пульс'}
              value={day.restingHr != null ? String(day.restingHr) : '—'}
              unit="уд/мин"
            />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function dayTitle(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

const styles = StyleSheet.create({
  total: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.lg },
  totalValue: { color: colors.text, fontSize: 76, fontWeight: '200', letterSpacing: -2 },
  totalCaption: { color: colors.textMuted, fontSize: 14 },
  components: { flexDirection: 'row', justifyContent: 'space-around' },
  component: { alignItems: 'center', gap: spacing.xs },
  componentValue: { color: colors.text, fontSize: 24, fontWeight: '300' },
  componentLabel: { color: colors.textMuted, fontSize: 14 },
  report: { color: colors.text, fontSize: 16, lineHeight: 24 },
});
