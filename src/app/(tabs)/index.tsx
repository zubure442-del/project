import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, STEPS_GOAL, formulaText, type ComponentId } from '../../domain';
import { findDay, todayKey, useSelectedDay, useVuelo } from '../../state';
import {
  BiometryBanner,
  IncompleteBanner,
  COMPONENT_LABEL,
  Card,
  HeroRing,
  InfoButton,
  Ring,
  Screen,
  Skeleton,
  SparkIcon,
  WeekChart,
  colors,
  radius,
  spacing,
} from '../../ui';

const COMPONENTS: ComponentId[] = ['sleep', 'activity', 'state'];
export default function TodayTab() {
  const { week, report, state, statusText, sync, profileReady, syncFailed } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useSelectedDay(state.days);
  const day = findDay(state.days, picked);
  const chartWidth = width - spacing.md * 4;
  const steps = day?.steps ?? null;
  // Кольцо отдаёт расход только за текущий день, за прошлые ничего не показываем.
  const calories = picked === todayKey() ? state.caloriesToday : null;

  return (
    <Screen
      title="Итог"
      date={picked}
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={
        <>
          {profileReady ? null : <BiometryBanner />}
          {syncFailed ? <IncompleteBanner onRetry={() => sync('retry')} /> : null}
        </>
      }
    >
      <View style={styles.total}>
        <HeroRing value={day?.total ?? null} size={Math.min(214, width - 140)} />
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

      <Card title="Шаги и калории">
        {steps === null ? (
          <Skeleton height={44} />
        ) : (
          <>
            <View style={styles.stepsRow}>
              <Text style={styles.steps}>{steps.toLocaleString('ru-RU')}</Text>
              {calories !== null ? (
                <View style={styles.calories}>
                  <Text style={styles.caloriesValue}>{calories}</Text>
                  <Text style={styles.caloriesLabel}>ккал</Text>
                  <InfoButton title="Калории" text={formulaText('calories')} />
                </View>
              ) : null}
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (steps / STEPS_GOAL) * 100)}%` }]} />
            </View>
          </>
        )}
      </Card>

      <Card>
        <View style={styles.aiHead}>
          <SparkIcon color={colors.accent} />
          <Text style={styles.aiTitle}>AI Ассистент</Text>
        </View>
        {report ? (
          <View style={styles.advice}>
            <Text style={styles.adviceText}>{report.text}</Text>
          </View>
        ) : (
          <Skeleton height={64} />
        )}
        <Text style={styles.poweredBy}>Powered by YandexGPT</Text>
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
  stepsRow: { flexDirection: 'row', alignItems: 'flex-end' },
  steps: { color: colors.text, fontSize: 38, fontWeight: '200', flex: 1 },
  calories: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  caloriesValue: { color: colors.text, fontSize: 22, fontWeight: '300' },
  caloriesLabel: { color: colors.textMuted, fontSize: 13, marginRight: 4 },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  aiTitle: { color: colors.text, fontSize: 17, fontWeight: '500' },
  advice: {
    backgroundColor: 'rgba(242, 169, 59, 0.10)',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(242, 169, 59, 0.28)',
    padding: spacing.md,
  },
  adviceText: { color: colors.text, fontSize: 18, lineHeight: 27 },
  poweredBy: { color: colors.textFaint, fontSize: 11, marginTop: spacing.sm, textAlign: 'right' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.track, marginTop: spacing.sm },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  report: { color: colors.text, fontSize: 16, lineHeight: 24 },
});
