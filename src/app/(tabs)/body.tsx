import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { stressZone } from '../../domain';
import { findDay, todayKey, useVuelo } from '../../state';
import { Card, HeartChart, InfoButton, Screen, Stat, StressChart, WeekStrip, colors, spacing, styles as ui } from '../../ui';

const STRESS_HELP =
  'Кольцо оценивает напряжение по пульсовой волне: 0–30 низкий, 31–60 умеренный, 61–80 повышенный, ' +
  '81–100 высокий. Это оценка, а не медицинский показатель, и в итог она не входит.';

const STATE_HELP =
  'Среднее двух оценок: вариабельность ритма и пульс во сне. Нужны обе — по одной цифре оценка была бы ' +
  'случайной. Вариабельность 65 мс и пульс 60 уд/мин дают максимум.';

const ESTIMATE_HELP =
  'Кольцо не измеряет давление и глюкозу, а оценивает их по пульсовой волне. Числа показаны как есть, ' +
  'выводов по ним приложение не делает и в итог их не берёт.';

export default function BodyTab() {
  const { week, state, busy, progress, statusText, sync } = useVuelo();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState(todayKey());
  const [metric, setMetric] = useState('score');
  const day = findDay(state.days, picked);
  const chartWidth = width - spacing.md * 4;
  const est = day?.estimates;
  const heart = day?.heart ?? [];
  const values = heart.map((p) => p.v);

  return (
    <Screen
      title="Тело"
      statusText={statusText}
      busy={busy}
      progress={progress}
      battery={state.battery}
      onSync={sync}
      onOpenRing={() => router.push('/ring')}
    >
      <WeekStrip
        days={week}
        metrics={[
          { id: 'score', label: 'Организм', value: (d) => d.scores.state },
          { id: 'pulse', label: 'Пульс во сне', value: (d) => (d.restingHrSource === 'night' ? d.restingHr : null) },
          { id: 'stress', label: 'Стресс', value: (d) => d.estimates.stress },
        ]}
        metricId={metric}
        onMetric={setMetric}
        selected={picked}
        onSelect={setPicked}
      />

      <Card title="Пульс">
        <HeartChart points={heart} width={chartWidth} />
        {values.length ? (
          <Text style={styles.range}>
            {Math.min(...values)} · {Math.max(...values)} уд/мин
          </Text>
        ) : null}
      </Card>

      <Card
        title="Стресс"
        right={<InfoButton title="Стресс" text={STRESS_HELP} />}
      >
        <StressChart points={day?.stress ?? []} width={chartWidth} />
        {est?.stress != null ? (
          <Text style={styles.range}>
            {Math.round(est.stress)} · {stressZone(Math.round(est.stress)) ?? '—'}
          </Text>
        ) : null}
      </Card>

      <Card title="Организм" right={<InfoButton title="Организм" text={STATE_HELP} />}>
        <View style={ui.statRow}>
          <Stat label="Оценка" value={day?.scores.state != null ? String(day.scores.state) : '—'} />
          <Stat
            label="Пульс во сне"
            value={day?.restingHrSource === 'night' && day.restingHr != null ? String(day.restingHr) : '—'}
            unit="уд/мин"
          />
          <Stat label="Вариабельность" value={est?.hrv != null ? String(Math.round(est.hrv)) : '—'} unit="мс" />
        </View>
      </Card>

      <Card title="Оценка кольца" right={<InfoButton title="Оценка кольца" text={ESTIMATE_HELP} />}>
        <View style={ui.statRow}>
          <Stat label="Давление · оценка" value={est?.systolic != null ? `${Math.round(est.systolic)}/${Math.round(est.diastolic ?? 0)}` : '—'} />
          <Stat label="Глюкоза · оценка" value={est?.glucose != null ? est.glucose.toFixed(1) : '—'} unit="ммоль/л" />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  range: { color: colors.textMuted, fontSize: 14, marginTop: spacing.xs },
});
