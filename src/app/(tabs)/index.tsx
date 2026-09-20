import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, STEPS_GOAL, formulaText, type ComponentId } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { COMPONENT_LABEL, Card, InfoButton, Ring, Screen, Skeleton, WeekChart, colors, spacing } from '../../ui';

const COMPONENTS: ComponentId[] = ['sleep', 'activity', 'state'];
/** Заголовок «Совет · Яндекс ИИ» включим, когда появится сервер-посредник. */
export const ADVICE_YANDEX_LABEL = __DEV__;

export default function TodayTab() {
  const { week, report, state, phase, progress, packets, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const day = findDay(state.days, picked);
  const chartWidth = width - spacing.md * 4;
  const steps = day?.steps ?? null;

  return (
    <Screen
      title="Итог"
      date={picked}
      statusText={statusText}
      loading={phase === 'background'}
      progress={progress}
      packets={packets}
      battery={state.battery}
      onSync={sync}
      onOpenRing={() => router.push('/ring')}
    >
      <View style={styles.total}>
        <Ring value={day?.total ?? null} size={Math.min(214, width - 140)} thickness={11} glow>
          <Text style={styles.totalValue}>{day?.total ?? '—'}</Text>
        </Ring>
      </View>

      <View style={styles.components}>
        {COMPONENTS.map((id) => (
          <View key={id} style={styles.component}>
            <Ring value={day?.scores[id] ?? null} size={78} thickness={6}>
              <Text style={styles.componentValue}>{day?.scores[id] ?? '—'}</Text>
            </Ring>
            <Text style={styles.componentLabel}>{COMPONENT_LABEL[id]}</Text>
          </View>
        ))}
      </View>

      <Card title="Шаги">
        {steps === null ? (
          <Skeleton height={44} />
        ) : (
          <>
            <Text style={styles.steps}>{steps}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (steps / STEPS_GOAL) * 100)}%` }]} />
            </View>
          </>
        )}
      </Card>

      <Card title={ADVICE_YANDEX_LABEL ? 'Совет · Яндекс ИИ' : 'Совет'}>
        {report ? <Text style={styles.report}>{report.text}</Text> : <Skeleton height={44} />}
      </Card>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.total.title} text={formulaText('total')} />}>
        <WeekChart days={week} value={(d) => d.total} selected={picked} onSelect={setPicked} width={chartWidth} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  totalValue: { color: colors.text, fontSize: 76, fontWeight: '200', letterSpacing: -2 },
  components: { flexDirection: 'row', justifyContent: 'space-around' },
  component: { alignItems: 'center', gap: spacing.xs },
  componentValue: { color: colors.text, fontSize: 24, fontWeight: '300' },
  componentLabel: { color: colors.textMuted, fontSize: 14 },
  steps: { color: colors.text, fontSize: 38, fontWeight: '200' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.track, marginTop: spacing.sm },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  report: { color: colors.text, fontSize: 16, lineHeight: 24 },
});
