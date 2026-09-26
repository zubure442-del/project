import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  TAB_INFO,
  bodyOf,
  busiestCycleHour,
  busiestHour,
  distanceMeters,
  formatCount,
  formatDistance,
  tabInfoText,
  weekActivity,
} from '../../domain';
import { findDay, useTabDay, useVuelo } from '../../state';
import { profileAge } from '../../storage';
import {
  DayBanner,
  CaloriesWeekCard,
  Card,
  DayActivityChart,
  HeroRing,
  Screen,
  Skeleton,
  colors,
  spacing,
  styles as ui,
  Stat,
} from '../../ui';

/** Кольцо в шапке: справа от него шаги, дистанция и калории — сравнения с неделей здесь нет. */
const HERO_RING = 150;

export default function ActivityTab() {
  const { week, state, statusText, sync, dayView } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, isToday, today } = useTabDay();
  const day = findDay(state.days, picked);
  // Сегодня график «День» идёт вдоль текущего цикла (от пробуждения, через полночь), прошлые дни — 0–24.
  const cycle = isToday ? today?.cycle ?? null : null;
  const chart = cycle?.chart ?? null;
  const age = profileAge(state.profile);
  // Самый активный час — по тем же рядам, что на графике: сегодня вдоль цикла, прошлые дни — по суткам.
  const best = chart
    ? busiestCycleHour(chart.steps, chart.heart, age, chart.from, chart.to)
    : day
      ? busiestHour(day.stepsByHour, day.heart, age)
      : null;
  const chartWidth = width - spacing.md * 4;
  // Калории считаем сами для любого дня; нет биометрии — «—».
  const calories = day?.calories ?? null;
  const weekBars = week.map((w) => ({ date: w.date, value: w.day?.calories ?? null }));
  // Оценка недели: средний расход по завершённым дням против коридора от базового обмена и цели.
  const activity = weekActivity({
    days: weekBars,
    today: dayView.today,
    body: bodyOf(state.profile),
    goal: state.profile.goal,
  });
  // Дистанция — от шагов после шумоподавления и роста из профиля; нет роста — не показываем.
  const distance = day?.steps != null && state.profile.heightCm !== null
    ? formatDistance(distanceMeters(day.steps, state.profile.heightCm))
    : null;

  return (
    <Screen
      info={{ title: TAB_INFO.activity.title, text: tabInfoText('activity') }}
      title="Активность"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      <View style={styles.hero}>
        {/* Индекс активности — по текущему циклу и только за сегодня; шаги, дистанция и калории — за сутки. */}
        {isToday ? <HeroRing value={cycle?.scores.activity ?? null} size={HERO_RING} /> : null}
        <View style={styles.heroSide}>
          {day?.steps != null ? (
            <View>
              {/* Сначала шаги и дистанция, чуть ниже — сожжённые калории. */}
              <Text style={styles.summary}>
                {formatCount(day.steps)} шагов{distance ? ` · ${distance}` : ''}
              </Text>
              <Text style={styles.burned}>Сожжено {calories === null ? '—' : formatCount(calories)} ккал</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Card title="День">
        {chart ? (
          <DayActivityChart
            heart={chart.heart}
            width={chartWidth}
            age={age}
            steps={chart.steps}
            restingHr={chart.restingHr}
            from={chart.from}
            to={chart.to}
          />
        ) : day ? (
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
          {/* Шаги уже написаны вверху экрана — под графиком только самый активный час. */}
          <Stat label="Самый активный час" value={best !== null ? `${best}:00` : '—'} />
        </View>
      </Card>

      {/* Расход за неделю меняется каждый день — на прошлых датах его нет. */}
      {isToday ? <CaloriesWeekCard days={weekBars} width={chartWidth} activity={activity} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, marginTop: spacing.md },
  heroSide: { flex: 1, gap: spacing.sm },
  summary: { color: colors.text, fontSize: 17 },
  burned: { color: colors.textMuted, fontSize: 15 },
  stats: { marginTop: spacing.md },
});
