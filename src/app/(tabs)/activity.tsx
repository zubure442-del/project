import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  TAB_INFO,
  busiestHour,
  distanceMeters,
  formatCount,
  formatDistance,
  tabInfoText,
} from '../../domain';
import { findDay, trendFor, useTabDay, useVuelo } from '../../state';
import { profileAge } from '../../storage';
import {
  DayBanner,
  CaloriesWeekCard,
  Card,
  DayActivityChart,
  HeroRing,
  Screen,
  Skeleton,
  WeekTrendCard,
  colors,
  spacing,
  styles as ui,
  Stat,
} from '../../ui';

export default function ActivityTab() {
  const { week, state, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner } = useTabDay();
  const day = findDay(state.days, picked);
  const age = profileAge(state.profile);
  const hours = day?.stepsByHour ?? [];
  const best = day ? busiestHour(hours, day.heart.map((p) => ({ m: p.m, v: p.v })), age) : null;
  const chartWidth = width - spacing.md * 4;
  // Калории считаем сами для любого дня; нет биометрии — «—».
  const calories = day?.calories ?? null;
  const weekBars = week.map((w) => ({ date: w.date, value: w.day?.calories ?? null }));
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
        <HeroRing value={day?.scores.activity ?? null} />
        {day?.steps != null ? (
          <>
            {/* Сначала шаги и дистанция, чуть ниже — сожжённые калории. */}
            <Text style={styles.summary}>
              {formatCount(day.steps)} шагов{distance ? ` · ${distance}` : ''}
            </Text>
            <Text style={styles.burned}>Сожжено {calories === null ? '—' : formatCount(calories)} ккал</Text>
          </>
        ) : null}
      </View>

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
          {/* Шаги уже написаны вверху экрана — под графиком только самый активный час. */}
          <Stat label="Самый активный час" value={best !== null ? `${best}:00` : '—'} />
        </View>
      </Card>

      <WeekTrendCard trend={trendFor(state, 'activity', picked)} />

      <CaloriesWeekCard days={weekBars} width={chartWidth} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
  summary: { color: colors.text, fontSize: 17 },
  burned: { color: colors.textMuted, fontSize: 15 },
  stats: { marginTop: spacing.md },
});
