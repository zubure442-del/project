import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FORMULAS, busiestHour, formulaText, weekCalories } from '../../domain';
import { findDay, heroHint, missingInputs, useTabDay, useVuelo } from '../../state';
import { profileAge } from '../../storage';
import {
  DayBanner,
  Card,
  DayActivityChart,
  HeroHint,
  HeroRing,
  InfoButton,
  Screen,
  Skeleton,
  WeekBars,
  WeekChart,
  colors,
  spacing,
  styles as ui,
  Stat,
} from '../../ui';

export default function ActivityTab() {
  const { week, state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, shownPhrase, view } = useTabDay();
  const day = findDay(state.days, picked);
  const age = profileAge(state.profile);
  const hours = day?.stepsByHour ?? [];
  const best = day ? busiestHour(hours, day.heart.map((p) => ({ m: p.m, v: p.v })), age) : null;
  const chartWidth = width - spacing.md * 4;
  // Калории считаем сами для любого дня; нет биометрии — «—».
  const calories = day?.calories ?? null;
  const weekBars = week.map((w) => ({ date: w.date, value: w.day?.calories ?? null }));
  const weekTotal = weekCalories(weekBars.map((b) => b.value));

  return (
    <Screen
      title="Активность"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} phrase={shownPhrase} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.activity ?? null} />
        {(day?.scores.activity ?? null) === null ? <HeroHint text={heroHint('activity', picked, view.today)} missing={missingInputs('activity', day)} /> : null}
        {day?.steps != null ? (
          <Text style={styles.summary}>
            {day.steps.toLocaleString('ru-RU')} шагов · {calories === null ? '—' : calories.toLocaleString('ru-RU')} ккал
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

      <Card title="Калории · неделя" right={<InfoButton title={FORMULAS.calories.title} text={formulaText('calories')} />}>
        <Text style={styles.weekTotal}>
          {weekTotal === null ? '—' : weekTotal.toLocaleString('ru-RU')}
          <Text style={styles.weekUnit}> ккал</Text>
        </Text>
        <WeekBars days={weekBars} width={chartWidth} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
  summary: { color: colors.textMuted, fontSize: 16 },
  stats: { marginTop: spacing.md },
  weekTotal: { color: colors.text, fontSize: 38, fontWeight: '200', marginBottom: spacing.sm },
  weekUnit: { color: colors.textMuted, fontSize: 15 },
});
