import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ComponentId } from '../../domain';
import { COMPONENT_LABEL, Card, Ring, Screen, Stat, colors, spacing, styles as ui } from '../../ui';
import { reportMode, reportTitle } from '../state';
import { useVuelo } from '../store';

const COMPONENTS: ComponentId[] = ['sleep', 'activity', 'state'];

/** «Сегодня»: итог, три составляющие, отчёт и короткие цифры. Графики — на других вкладках. */
export default function TodayTab() {
  const { today, report, state, busy, progress, statusText, sync, forgetDemo } = useVuelo();
  const { width } = useWindowDimensions();
  const sleep = today?.sleep;

  return (
    <Screen
      title="Сегодня"
      statusText={statusText}
      busy={busy}
      progress={progress}
      demo={state.demo}
      onSync={sync}
      onForgetDemo={forgetDemo}
    >
      <View style={styles.totalBlock}>
        <Ring value={today?.total ?? null} size={Math.min(226, width - 120)} thickness={11} glow>
          <Text style={styles.totalValue}>{today?.total ?? '—'}</Text>
          <Text style={styles.totalCaption}>Итог Vuelo</Text>
        </Ring>
      </View>

      <View style={styles.components}>
        {COMPONENTS.map((id) => (
          <View key={id} style={styles.component}>
            <Ring value={today?.scores[id] ?? null} size={82} thickness={6}>
              <Text style={styles.componentValue}>{today?.scores[id] ?? '—'}</Text>
            </Ring>
            <Text style={styles.componentLabel}>{COMPONENT_LABEL[id]}</Text>
          </View>
        ))}
      </View>
      {today && COMPONENTS.some((id) => today.scores[id] === null) ? (
        <Text style={styles.hint}>Прочерк — недостаточно данных. Такие составляющие в итог не берутся.</Text>
      ) : null}

      {report ? (
        <Card title={reportTitle(reportMode(new Date()))}>
          <Text style={styles.reportText}>{report.text}</Text>
        </Card>
      ) : null}

      <Card title="Коротко">
        <View style={ui.statRow}>
          <Stat label="Сон" value={sleep ? `${Math.floor(sleep.totalMin / 60)}ч ${sleep.totalMin % 60}м` : '—'} />
          <Stat label="Шаги" value={today?.steps != null ? String(today.steps) : '—'} />
          <Stat label="Пульс покоя" value={today?.restingHr != null ? String(today.restingHr) : '—'} unit="уд/мин" />
          <Stat
            label="Кислород"
            value={today?.spo2.length ? `${today.spo2[today.spo2.length - 1].v}` : '—'}
            unit={today?.spo2.length ? '%' : undefined}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  totalBlock: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.lg },
  totalValue: { color: colors.text, fontSize: 82, fontWeight: '100', letterSpacing: -2 },
  totalCaption: { color: colors.textMuted, fontSize: 14, marginTop: 2, letterSpacing: 0.5 },
  components: { flexDirection: 'row', justifyContent: 'space-around' },
  component: { alignItems: 'center', gap: spacing.xs },
  componentValue: { color: colors.text, fontSize: 25, fontWeight: '200' },
  componentLabel: { color: colors.textMuted, fontSize: 14 },
  hint: { color: colors.textMuted, fontSize: 12.5, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  reportText: { color: colors.text, fontSize: 17, lineHeight: 25, fontWeight: '300' },
});
