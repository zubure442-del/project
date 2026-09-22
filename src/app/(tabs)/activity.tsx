import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  STEPS_DEFAULT_NORM,
  TAB_INFO,
  busiestHour,
  distanceMeters,
  formatCount,
  formatDistance,
  tabInfoText,
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
  WeekChart,
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
  // Шаги за день — после шумоподавления, норма — своя на день.
  const norm = day?.stepNorm?.value ?? STEPS_DEFAULT_NORM;
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
        {day?.steps != null ? (
          <View style={styles.norm}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (day.steps / norm) * 100)}%` }]} />
            </View>
            <Text style={styles.normText}>
              {Math.round((day.steps / norm) * 100)} % нормы · {formatCount(norm)}
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
          <Stat label="Шаги" value={day?.steps != null ? formatCount(day.steps) : '—'} />
          <Stat label="Самый активный час" value={best !== null ? `${best}:00` : '—'} />
        </View>
      </Card>

      <CaloriesWeekCard days={weekBars} width={chartWidth} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
  summary: { color: colors.text, fontSize: 17 },
  burned: { color: colors.textMuted, fontSize: 15 },
  norm: { width: '70%', gap: 6, alignItems: 'center' },
  track: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: colors.track },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  normText: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  stats: { marginTop: spacing.md },
});
