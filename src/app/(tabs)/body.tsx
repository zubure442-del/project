import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  Card,
  HeartChart,
  Screen,
  Spo2Chart,
  Stat,
  StressChart,
  colors,
  spacing,
  styles as ui,
} from '../../ui';
import { spo2Fallback } from '../state';
import { useVuelo } from '../store';

/** «Тело»: пульс, кислород, напряжение и оценочные показатели. */
export default function BodyTab() {
  const { today, week, state, busy, progress, statusText, sync, forgetDemo } = useVuelo();
  const { width } = useWindowDimensions();
  const chartWidth = width - spacing.md * 4;

  const fallback = today?.spo2.length ? null : spo2Fallback(week);
  const spo2Points = today?.spo2.length ? today.spo2 : (fallback?.points ?? []);
  const lastSpo2 = spo2Points.length ? spo2Points[spo2Points.length - 1] : null;
  const est = today?.estimates;
  const num = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? '—' : v.toFixed(digits);

  return (
    <Screen
      title="Тело"
      statusText={statusText}
      busy={busy}
      progress={progress}
      demo={state.demo}
      onSync={sync}
      onForgetDemo={forgetDemo}
    >
      <Card title="Пульс" note="точки — замеры, линия — сглажено">
        <HeartChart points={today?.heart ?? []} width={chartWidth} />
        <View style={styles.inlineStats}>
          <Text style={styles.inline}>Пульс покоя: {today?.restingHr != null ? `${today.restingHr} уд/мин` : '—'}</Text>
        </View>
      </Card>

      <Card title="Кислород в крови" note={fallback ? `сегодня замеров нет, показаны последние ${fallback.days} дня` : 'редкие замеры'}>
        <Spo2Chart points={spo2Points} width={chartWidth} />
        <Text style={styles.inline}>
          {lastSpo2 ? `Последний замер: ${lastSpo2.v}%` : 'Кольцо мерит кислород редко и только при неподвижной руке.'}
        </Text>
      </Card>

      <Card title="Напряжение" note="индекс кольца, 0–100">
        <StressChart points={today?.stress ?? []} width={chartWidth} />
        <Text style={styles.inline}>
          {est?.stress != null ? `Среднее за день: ${Math.round(est.stress)}` : 'За сегодня замеров нет.'}
        </Text>
      </Card>

      <Card title="Оценка" note="не измерение, выводов не делаем">
        <View style={ui.statRow}>
          <Stat label="Вариабельность" value={num(est?.hrv)} unit={est?.hrv != null ? 'мс' : undefined} />
          <Stat label="Глюкоза" value={num(est?.glucose, 1)} unit={est?.glucose != null ? 'ммоль/л' : undefined} />
          <Stat
            label="Давление"
            value={est?.systolic != null ? `${Math.round(est.systolic)}/${Math.round(est.diastolic ?? 0)}` : '—'}
          />
          <Stat label="Оценка организма" value={today?.scores.state != null ? String(today.scores.state) : '—'} unit="из 100" />
        </View>
        <Text style={ui.disclaimer}>
          Глюкозу и давление кольцо оценивает по пульсовой волне, а не измеряет. Приложение показывает эти числа как
          есть и не делает по ним выводов. В итог Vuelo они не входят.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inlineStats: { marginTop: spacing.sm },
  inline: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
});
