import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ComponentId } from '../../domain';
import { adviceLabel, findDay, recommendationsFor, relayFor, useTabDay, useVuelo } from '../../state';
import {
  DayBanner,
  COMPONENT_LABEL,
  AssistantCarousel,
  Calibration,
  HeroRing,
  MascotHero,
  Ring,
  Screen,
  colors,
  spacing,
} from '../../ui';

const COMPONENTS: ComponentId[] = ['sleep', 'activity', 'state'];

export default function TodayTab() {
  const { state, statusText, sync, dayView } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, complete } = useTabDay();
  const day = findDay(state.days, picked);
  // Сегодня вместо колец итога и трёх метрик — маскот с итогом дня; на прошлых датах кольца как были.
  const isToday = picked === dayView.today;
  // Рекомендации (совет, кофейное окно, «Скоро») — только за сегодня; на прошлом дне блока нет вовсе.
  const recs = recommendationsFor(state, picked);
  const relay = relayFor(state);

  return (
    <Screen
      title="Итог"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      {isToday && complete ? (
        <MascotHero total={day?.total ?? null} relay={relay} width={width} />
      ) : !complete ? (
        // Пока день неполный, на экране только объяснение: ни маскота, ни полоски эстафеты.
        <Calibration today={isToday} returning={state.hadCompleteDay} />
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
