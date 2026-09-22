import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { distanceMeters, formatDistance, type ComponentId } from '../../domain';
import { adviceLabel, findDay, recommendationsFor, useTabDay, useVuelo } from '../../state';
import {
  DayBanner,
  COMPONENT_LABEL,
  AssistantCarousel,
  Calibration,
  Card,
  HeroRing,
  NutsBalance,
  Ring,
  Screen,
  Skeleton,
  WeekChart,
  colors,
  spacing,
} from '../../ui';

const COMPONENTS: ComponentId[] = ['sleep', 'activity', 'state'];
export default function TodayTab() {
  const { week, state, statusText, sync, dayView } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, complete } = useTabDay();
  const day = findDay(state.days, picked);
  // Рекомендации (совет, кофейное окно, «Скоро») — только за сегодня; на прошлом дне блока нет вовсе.
  const recs = recommendationsFor(state, picked);
  const chartWidth = width - spacing.md * 4;
  const steps = day?.steps ?? null;
  // Калории выбранного дня по нашей модели; нет биометрии — «—».
  const calories = day?.calories ?? null;

  return (
    <Screen
      title="Итог"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
      accessory={<NutsBalance nuts={state.relay.nuts} />}
    >
      {!complete ? (
        <Calibration today={picked === dayView.today} />
      ) : (
      <>
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

      {recs ? (
        <AssistantCarousel
          slides={recs.slides}
          advice={recs.advice?.text ?? null}
          adviceLabel={adviceLabel(picked)}
          relay={recs.relay}
          coffee={recs.coffee}
        />
      ) : null}

      <Card title="Неделя">
        <WeekChart
          days={week}
          value={(d) => d.total}
          selected={picked}
          width={chartWidth}
        />
      </Card>
      </>
      )}
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
});
