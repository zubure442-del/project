import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentId, Report } from '../domain';
import type { DaySnapshot } from '../storage';
import { HeartChart, Spo2Chart, WeekBars } from './Charts';
import { Logo } from './Logo';
import { Ring } from './Ring';
import { COMPONENT_LABEL, colors, radius, spacing, withAlpha } from './theme';

const NO_DATA = 'Недостаточно данных';

const dayLabel = (date: string) => ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(`${date}T12:00:00Z`).getUTCDay()];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ComponentRing({ id, value }: { id: ComponentId; value: number | null }) {
  return (
    <View style={styles.component}>
      <Ring value={value} size={82} thickness={6}>
        <Text style={styles.componentValue}>{value === null ? '—' : value}</Text>
      </Ring>
      <Text style={styles.componentLabel}>{COMPONENT_LABEL[id]}</Text>
    </View>
  );
}

function Estimate({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.estimate}>
      <Text style={styles.estimateLabel}>{label}</Text>
      <Text style={styles.estimateValue}>
        {value}
        {unit ? <Text style={styles.estimateUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export interface TodayProps {
  today: DaySnapshot | null;
  week: DaySnapshot[];
  report: Report | null;
  /** Заголовок отчёта зависит от времени суток: утром про ночь, вечером про день. */
  reportTitle: string;
  battery: number | null;
  /** SpO2 за последние 3 дня, если сегодня замеров нет. */
  spo2Fallback: { points: DaySnapshot['spo2']; days: number } | null;
  /** Показаны выдуманные данные — об этом надо сказать прямо. */
  demo?: boolean;
  onForgetDemo?: () => void;
  footer?: React.ReactNode;
}

export function Today({ today, week, report, reportTitle, battery, spo2Fallback, demo, onForgetDemo, footer }: TodayProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const chartWidth = width - spacing.md * 2 - spacing.md * 2;
  const sleep = today?.sleep;
  const est = today?.estimates;
  const spo2Points = today?.spo2.length ? today.spo2 : (spo2Fallback?.points ?? []);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }}
    >
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerTitle}>Сегодня</Text>
        <View style={styles.headerRight}>
          {battery !== null ? <Text style={styles.battery}>Кольцо {battery}%</Text> : null}
        </View>
      </View>

      {demo ? (
        <Pressable style={styles.demoBadge} onPress={onForgetDemo}>
          <Text style={styles.demoText}>Демо-данные · нажмите, чтобы убрать</Text>
        </Pressable>
      ) : null}

      <View style={styles.totalBlock}>
        <Ring value={today?.total ?? null} size={216} thickness={11} glow>
          <Text style={styles.totalValue}>{today?.total ?? '—'}</Text>
          <Text style={styles.totalCaption}>Итог Vuelo</Text>
        </Ring>
      </View>

      <View style={styles.components}>
        {(['sleep', 'activity', 'state'] as ComponentId[]).map((id) => (
          <ComponentRing key={id} id={id} value={today?.scores[id] ?? null} />
        ))}
      </View>

      {report ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{reportTitle}</Text>
          <Text style={styles.reportText}>{report.text}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ночь и день</Text>
        <View style={styles.statRow}>
          <Estimate label="Сон" value={sleep ? `${Math.floor(sleep.totalMin / 60)}ч ${sleep.totalMin % 60}м` : '—'} />
          <Estimate label="Глубокий" value={sleep ? `${Math.floor(sleep.deepMin / 60)}ч ${sleep.deepMin % 60}м` : '—'} />
          <Estimate label="Шаги" value={today?.steps !== null && today?.steps !== undefined ? String(today.steps) : '—'} />
          <Estimate label="Пульс покоя" value={today?.restingHr !== null && today?.restingHr !== undefined ? String(today.restingHr) : '—'} unit="уд/мин" />
        </View>
      </View>

      <Section title="Пульс">
        <View style={styles.card}>
          <HeartChart points={today?.heart ?? []} width={chartWidth} />
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={styles.legendDot} />
              <Text style={styles.legendText}>замеры</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendLine} />
              <Text style={styles.legendText}>сглажено</Text>
            </View>
          </View>
        </View>
      </Section>

      <Section
        title="Кислород в крови"
        note={today?.spo2.length ? 'редкие замеры' : spo2Fallback ? `за ${spo2Fallback.days} дня` : undefined}
      >
        <View style={styles.card}>
          <Spo2Chart points={spo2Points} width={chartWidth} />
        </View>
      </Section>

      <Section title="Неделя">
        <View style={styles.card}>
          <WeekBars days={week} width={chartWidth} />
          <View style={styles.weekLabels}>
            {week.map((d) => (
              <Text key={d.date} style={styles.weekLabel}>{dayLabel(d.date)}</Text>
            ))}
          </View>
        </View>
      </Section>

      <Section title="Оценка" note="не измерение, выводов не делаем">
        <View style={styles.card}>
          <View style={styles.statRow}>
            <Estimate label="Вариабельность" value={est?.hrv !== null && est?.hrv !== undefined ? String(Math.round(est.hrv)) : '—'} unit="мс" />
            <Estimate label="Глюкоза" value={est?.glucose !== null && est?.glucose !== undefined ? est.glucose.toFixed(1) : '—'} unit="ммоль/л" />
            <Estimate
              label="Давление"
              value={est?.systolic !== null && est?.systolic !== undefined ? `${Math.round(est.systolic)}/${Math.round(est.diastolic ?? 0)}` : '—'}
            />
            <Estimate label="Напряжение" value={est?.stress !== null && est?.stress !== undefined ? String(Math.round(est.stress)) : '—'} />
          </View>
          <Text style={styles.disclaimer}>
            Глюкоза и давление у кольца — оценка по пульсовой волне, а не измерение. Приложение не делает по ним выводов.
          </Text>
        </View>
      </Section>

      {today === null ? <Text style={styles.noData}>{NO_DATA}. Синхронизируйте кольцо.</Text> : null}
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '500' },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  battery: { color: colors.textMuted, fontSize: 14 },

  demoBadge: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  demoText: { color: colors.textMuted, fontSize: 12.5 },
  totalBlock: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.lg },
  totalValue: { color: colors.text, fontSize: 82, fontWeight: '100', letterSpacing: -2 },
  totalCaption: { color: colors.textMuted, fontSize: 14, marginTop: 2, letterSpacing: 0.5 },

  components: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.lg },
  component: { alignItems: 'center', gap: spacing.xs },
  componentValue: { color: colors.text, fontSize: 25, fontWeight: '200' },
  componentLabel: { color: colors.textMuted, fontSize: 14 },

  section: { marginTop: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: spacing.md + spacing.xs, gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '500' },
  sectionNote: { color: colors.textMuted, fontSize: 12.5, flex: 1 },

  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.card,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm, letterSpacing: 0.6, textTransform: 'uppercase' },
  reportText: { color: colors.text, fontSize: 17, lineHeight: 25, fontWeight: '300' },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  estimate: { width: '50%' },
  estimateLabel: { color: colors.textMuted, fontSize: 13, marginBottom: 3 },
  estimateValue: { color: colors.text, fontSize: 24, fontWeight: '200' },
  estimateUnit: { color: colors.textMuted, fontSize: 13, fontWeight: '400' },
  disclaimer: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: spacing.md },

  legend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: withAlpha(colors.accent, 0.45) },
  legendLine: { width: 16, height: 2.5, borderRadius: 2, backgroundColor: colors.accent },
  legendText: { color: colors.textMuted, fontSize: 12.5 },
  weekLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -14 },
  weekLabel: { color: colors.textMuted, fontSize: 13, flex: 1, textAlign: 'center' },

  noData: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
