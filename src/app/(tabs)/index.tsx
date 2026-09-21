import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { distanceMeters, formatDistance, type ComponentId } from '../../domain';
import { adviceFor, adviceLabel, findDay, useTabDay, useVuelo } from '../../state';
import {
  DayBanner,
  COMPONENT_LABEL,
  Card,
  HeroRing,
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
  // Кольцо отдаёт расход только за текущий день, за прошлые ничего не показываем.
  // Калории выбранного дня по нашей модели; нет биометрии — «—».
  const calories = day?.calories ?? null;

  return (
    <Screen
      title="Итог"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} phrase={shownPhrase} onRetry={() => sync('retry')} />}
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

      <Card title="Дистанция и калории">
        {steps === null ? (
          <Skeleton height={44} />
        ) : (
          <View style={styles.stepsRow}>
            {/* Дистанция — от шагов после шумоподавления и роста из профиля. */}
            <Text style={styles.steps}>
              {state.profile.heightCm === null ? '—' : formatDistance(distanceMeters(steps, state.profile.heightCm))}
            </Text>
            <View style={styles.calories}>
              <Text style={styles.caloriesValue}>{calories === null ? '—' : calories.toLocaleString('ru-RU')}</Text>
              <Text style={styles.caloriesLabel}>ккал</Text>
            </View>
          </View>
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

      <Card title="Неделя">
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
  report: { color: colors.text, fontSize: 16, lineHeight: 24 },
});
