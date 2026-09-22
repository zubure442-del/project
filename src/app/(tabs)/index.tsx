import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ComponentId } from '../../domain';
import { adviceLabel, findDay, recommendationsFor, relayFor, useTabDay, useVuelo } from '../../state';
import {
  DayBanner,
  COMPONENT_LABEL,
  AssistantCarousel,
  Calibration,
  Card,
  HeroRing,
  MascotHero,
  Ring,
  Screen,
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
  // Сегодня вместо колец итога и трёх метрик — маскот с итогом дня; на прошлых датах кольца как были.
  const isToday = picked === dayView.today;
  // Рекомендации (совет, кофейное окно, «Скоро») — только за сегодня; на прошлом дне блока нет вовсе.
  const recs = recommendationsFor(state, picked);
  const relay = relayFor(state);
  const chartWidth = width - spacing.md * 4;

  return (
    <Screen
      title="Итог"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      {isToday ? (
        <>
          {/* День ещё не полный: сначала объяснение, маскот с эстафетой остаётся доступен. */}
          {complete ? null : <Calibration today />}
          <MascotHero total={complete ? day?.total ?? null : null} relay={relay} width={width} />
        </>
      ) : !complete ? (
        <Calibration today={false} />
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
        </>
      )}

      {complete ? (
        <>
          {recs ? (
            <AssistantCarousel
              slides={recs.slides}
              advice={recs.advice?.text ?? null}
              adviceLabel={adviceLabel(picked)}
              coffee={recs.coffee}
            />
          ) : null}

          <Card title="Неделя">
            <WeekChart days={week} value={(d) => d.total} selected={picked} width={chartWidth} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  components: { flexDirection: 'row', justifyContent: 'space-around' },
  component: { alignItems: 'center', gap: spacing.xs },
  componentValue: { color: colors.text, fontSize: 24, fontWeight: '300' },
  componentLabel: { color: colors.textMuted, fontSize: 14 },
});
