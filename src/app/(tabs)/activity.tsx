import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, busiestHour, formulaText } from '../../domain';
import { findDay, todayKey, useTabDay, useVuelo } from '../../state';
import { profileAge } from '../../storage';
import {
  DayBanner,
  Card,
  DayActivityChart,
  HeroRing,
  InfoButton,
  Screen,
  Skeleton,
  WeekChart,
  colors,
  spacing,
  styles as ui,
  Stat,
} from '../../ui';

export default function ActivityTab() {
  const { week, state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, shownPhrase } = useTabDay();
  const day = findDay(state.days, picked);
  const age = profileAge(state.profile);
  const hours = day?.stepsByHour ?? [];
  const best = day ? busiestHour(hours, day.heart.map((p) => ({ m: p.m, v: p.v })), age) : null;
  const chartWidth = width - spacing.md * 4;
  const calories = picked === todayKey() ? state.caloriesToday : null;

  return (
    <Screen
      title="Активность"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} phrase={shownPhrase} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.activity ?? null} calibrating={!!day && day.scores.activity === null} />
        {day?.steps != null ? (
          <Text style={styles.summary}>
            {day.steps.toLocaleString('ru-RU')} шагов
            {calories !== null ? ` · ${calories} ккал` : ''}
          </Text>
        ) : null}
      </View>

      <Card title="Неделя" right={<InfoButton title={FORMULAS.activity.title} text={formulaText('activity')} />}>
        <WeekChart
          days={week}
          value={(d) => d.scores.activity}
          selected={picked}
          width={chartWidth}
        />
      </Card>

      <Card title="День" right={<InfoButton title={FORMULAS.busiestHour.title} text={formulaText('busiestHour')} />}>
        {day ? (
          <DayActivityChart
            heart={day.heart}
            width={chartWidth}
            age={age}
            steps={day.stepsByMinute}
            restingHr={day.restingHr}
          />
        ) : (
          <Skeleton height={130} />
        )}
        <View style={[ui.statRow, styles.stats]}>
          <Stat label="Шаги" value={day?.steps != null ? day.steps.toLocaleString('ru-RU') : '—'} />
          <Stat label="Самый активный час" value={best !== null ? `${best}:00` : '—'} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
  summary: { color: colors.textMuted, fontSize: 16 },
  stats: { marginTop: spacing.md },
});
