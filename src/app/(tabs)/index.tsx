import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, STEPS_DEFAULT_NORM, formulaText, type ComponentId } from '../../domain';
import { adviceFor, adviceLabel, findDay, todayKey, useTabDay, useVuelo } from '../../state';
import {
  DayBanner,
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
  const { week, state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, shownPhrase } = useTabDay();
  const day = findDay(state.days, picked);
  const advice = adviceFor(state, picked);
  const chartWidth = width - spacing.md * 4;
  const steps = day?.steps ?? null;
  // Своя норма дня; у старых сводок из кэша её нет — тогда 10 000.
  const norm = day?.stepNorm?.value ?? STEPS_DEFAULT_NORM;
  // Кольцо отдаёт расход только за текущий день, за прошлые ничего не показываем.
  const calories = picked === todayKey() ? state.caloriesToday : null;

  return (
    <Screen
      title="Итог"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} phrase={shownPhrase} onRetry={() => sync('retry')} />}
    >
      <View style={styles.total}>
        <HeroRing value={day?.total ?? null} calibrating={!!day && day.total === null} size={Math.min(214, width - 140)} />
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

      <Card title="Шаги и калории" right={<InfoButton title={FORMULAS.stepNorm.title} text={formulaText('stepNorm')} />}>
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
            <View style={styles.normRow}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, (steps / norm) * 100)}%` }]} />
              </View>
              <Text style={styles.norm}>из {norm.toLocaleString('ru-RU')}</Text>
            </View>
          </>
        )}
      </Card>

      <Card>
        <View style={styles.aiHead}>
          <SparkIcon color={colors.accent} />
          <Text style={styles.aiTitle}>AI Ассистент</Text>
        </View>
        {advice ? (
          <>
            <Text style={styles.adviceLabel}>{adviceLabel(picked)}</Text>
            <View style={styles.advice}>
              <Text style={styles.adviceText}>{advice.text}</Text>
            </View>
          </>
        ) : (
          // Совет — только для полного дня: по неполному он вышел бы случайным.
          <Text style={styles.adviceEmpty}>Совет появится, когда день будет полным</Text>
        )}
        <Text style={styles.poweredBy}>Powered by YandexGPT</Text>
      </Card>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.total.title} text={formulaText('total')} />}>
        <WeekChart
          days={week}
          value={(d) => d.total}
          selected={picked}
          width={chartWidth}
        />
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
  adviceLabel: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  adviceEmpty: { color: colors.textFaint, fontSize: 15 },
  poweredBy: { color: colors.textFaint, fontSize: 11, marginTop: spacing.sm, textAlign: 'right' },
  normRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.track },
  norm: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  report: { color: colors.text, fontSize: 16, lineHeight: 24 },
});
