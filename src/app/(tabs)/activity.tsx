import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { STEPS_DEFAULT_NORM, TAB_INFO, busiestHour, tabInfoText, weekCalories } from '../../domain';
import { findDay, useTabDay, useVuelo } from '../../state';
import { profileAge } from '../../storage';
import {
  DayBanner,
  Card,
  DayActivityChart,
  HeroRing,
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
  const { date: picked, banner, shownPhrase } = useTabDay();
  const day = findDay(state.days, picked);
  const age = profileAge(state.profile);
  const hours = day?.stepsByHour ?? [];
  const best = day ? busiestHour(hours, day.heart.map((p) => ({ m: p.m, v: p.v })), age) : null;
  const chartWidth = width - spacing.md * 4;
  // Калории считаем сами для любого дня; нет биометрии — «—».
  const calories = day?.calories ?? null;
  // Шаги за день — после шумоподавления, норма — своя на день.
  const norm = day?.stepNorm?.value ?? STEPS_DEFAULT_NORM;
  const weekBars = week.map((w) => ({ date: w.date, value: w.day?.calories ?? null }));
  const weekTotal = weekCalories(weekBars.map((b) => b.value));

  return (
    <Screen
      info={{ title: TAB_INFO.activity.title, text: tabInfoText('activity') }}
      title="Активность"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} phrase={shownPhrase} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        <HeroRing value={day?.scores.activity ?? null} />
        {day?.steps != null ? (
          <Text style={styles.summary}>
            {day.steps.toLocaleString('ru-RU')} шагов · {calories === null ? '—' : calories.toLocaleString('ru-RU')} ккал
          </Text>
        ) : null}
        {day?.steps != null ? (
          <View style={styles.norm}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (day.steps / norm) * 100)}%` }]} />
            </View>
            <Text style={styles.normText}>
              {Math.round((day.steps / norm) * 100)} % нормы · {norm.toLocaleString('ru-RU')}
            </Text>
          </View>
        ) : null}
      </View>

      <Card title="Неделя">
        <WeekChart
          days={week}
          value={(d) => d.scores.activity}
          selected={picked}
          width={chartWidth}
        />
      </Card>

      <Card title="День">
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

      <Card title="Калории · неделя">
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
  norm: { width: '70%', gap: 6, alignItems: 'center' },
  track: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: colors.track },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  normText: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  stats: { marginTop: spacing.md },
  weekTotal: { color: colors.text, fontSize: 38, fontWeight: '200', marginBottom: spacing.sm },
  weekUnit: { color: colors.textMuted, fontSize: 15 },
});
