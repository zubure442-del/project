import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  Card,
  HeartChart,
  Screen,
  Spo2Chart,
  Spo2DaysChart,
  Stat,
  StressChart,
  colors,
  spacing,
  styles as ui,
} from '../../ui';
import { stressZone } from '../../domain';
import { lastSpo2, spo2Days, useVuelo } from '../../state';
import { router } from 'expo-router';

const STRESS_HELP =
  'Индекс кольца от 0 до 100, четыре зоны: 0–30 низкий, 31–60 умеренный, 61–80 повышенный, ' +
  '81–100 высокий. Кольцо оценивает его по пульсовой волне — это оценка, а не медицинский ' +
  'показатель, и в итог Vuelo он не входит. Значение 0 замером не считается.';

/** «Тело»: пульс, кислород, стресс и оценочные показатели. */
export default function BodyTab() {
  const { today, state, busy, progress, statusText, sync, setDemo } = useVuelo();
  const { width } = useWindowDimensions();
  const [stressHelp, setStressHelp] = useState(false);
  const chartWidth = width - spacing.md * 4;

  const days = state.days;
  const recent = spo2Days(days);
  const showDays = !today?.spo2.length && recent.length > 1;
  const last = lastSpo2(days);
  const est = today?.estimates;
  const num = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? '—' : v.toFixed(digits);

  const inputs = today?.stateInputs;
  const missing = inputs
    ? [!inputs.spo2 && 'кислорода', !inputs.hrv && 'вариабельности', !inputs.restingHr && 'пульса покоя'].filter(
        Boolean,
      )
    : [];

  return (
    <Screen
      title="Тело"
      statusText={statusText}
      busy={busy}
      progress={progress}
      demo={state.demo}
      battery={state.battery}
      onSync={sync}
      onForgetDemo={() => setDemo(false)}
      onOpenSettings={() => router.push('/settings')}
    >
      <Card title="Пульс" note="точки — замеры, линия — сглажено">
        <HeartChart points={today?.heart ?? []} width={chartWidth} />
        <Text style={styles.inline}>
          {today?.restingHr != null
            ? `${today.restingHrSource === 'night' ? 'Пульс покоя' : 'Мин. пульс за день'}: ${today.restingHr} уд/мин`
            : 'Пульс покоя появится после ночи с кольцом.'}
        </Text>
      </Card>

      <Card title="Кислород в крови" note={showDays ? 'сегодня замеров нет, показаны последние дни' : 'редкие замеры'}>
        {showDays ? (
          <Spo2DaysChart days={recent} width={chartWidth} />
        ) : (
          <Spo2Chart points={today?.spo2 ?? []} width={chartWidth} />
        )}
        <Text style={styles.inline}>
          {last ? `Последний замер: ${last.value} % · ${last.when}` : 'Кольцо мерит кислород редко и только при неподвижной руке.'}
        </Text>
      </Card>

      <Card>
        <Pressable onPress={() => setStressHelp((v) => !v)} hitSlop={6}>
          <Text style={ui.cardTitle}>Стресс {stressHelp ? '⌃' : 'ⓘ'}</Text>
        </Pressable>
        {stressHelp ? <Text style={styles.help}>{STRESS_HELP}</Text> : null}
        <StressChart points={today?.stress ?? []} width={chartWidth} />
        <Text style={styles.inline}>
          {est?.stress != null
            ? `Среднее за день: ${Math.round(est.stress)} · ${stressZone(Math.round(est.stress)) ?? '—'}`
            : 'За сегодня замеров нет.'}
        </Text>
      </Card>

      <Card title="Организм" note={today?.scores.state != null ? 'из 100' : 'недостаточно данных'}>
        <Text style={styles.score}>{today?.scores.state ?? '—'}</Text>
        <Text style={ui.disclaimer}>
          Среднее трёх оценок: кислород (100 при 95 % и выше), вариабельность (100 при 65 мс) и пульс покоя за ночь
          (100 при 60 уд/мин и ниже). Нужны хотя бы два входа из трёх, иначе оценка не выставляется: по одному замеру
          кислорода получилось бы 100 из 100 на пустом месте.
          {missing.length ? ` Сейчас не хватает: ${missing.join(', ')}.` : ''}
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
  inline: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
  help: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  score: { color: colors.text, fontSize: 44, fontWeight: '100', marginBottom: spacing.sm },
});
