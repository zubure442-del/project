import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BATTERY_STALE_MS, useVuelo } from '../../state';
import { AUTO_MEASURE_PERIODS, type AutoMeasurePeriod } from '../../codec';
import { EMPTY_PROFILE, PROFILE_LIMITS, profileAge, type Goal, type Profile, type Sex } from '../../storage';
import { Card, colors, radius, spacing } from '../../ui';

const DISCLAIMER =
  'Не медицинский прибор. Показатели носят справочный характер и не заменяют врача. ' +
  'Давление и глюкоза — оценка кольца. Данные хранятся только на этом телефоне.';

const SEX: { id: Sex; label: string }[] = [
  { id: 'male', label: 'М' },
  { id: 'female', label: 'Ж' },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: 'lose', label: 'Похудение' },
  { id: 'gain', label: 'Набор мышечной массы' },
  { id: 'keep', label: 'Поддержание формы' },
];

export default function ProfileTab() {
  const { state, statusText, saveProfile, forgetRing, setAutoMeasure, clearData } = useVuelo();
  const insets = useSafeAreaInsets();
  const [about, setAbout] = useState(false);
  const [taps, setTaps] = useState(0);
  const [draft, setDraft] = useState<Profile>(state.profile);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  // Время берём из состояния, а не из Date.now() при отрисовке: иначе экран считается «грязным».
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const battery = useMemo(() => {
    if (state.batteryAt === null) return { stale: false, time: '' };
    const d = new Date(state.batteryAt);
    return {
      stale: now > 0 && now - state.batteryAt > BATTERY_STALE_MS,
      time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
    };
  }, [now, state.batteryAt]);

  const commit = (patch: Partial<Profile>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveProfile(next);
  };

  const number = (text: string, key: 'heightCm' | 'weightKg' | 'birthYear') => {
    const value = Number(text.replace(/\D/g, ''));
    setDraft((prev) => ({ ...prev, [key]: Number.isFinite(value) && value > 0 ? value : null }));
  };

  const blur = (key: 'heightCm' | 'weightKg' | 'birthYear') => {
    const value = draft[key];
    const ok = value !== null && valid(key, value);
    commit({ [key]: ok ? value : null });
    if (value !== null && !ok) setDraft((prev) => ({ ...prev, [key]: null }));
  };

  const forget = () =>
    Alert.alert('Забыть кольцо?', 'Данные кольца на телефоне будут удалены, кольцо придётся найти заново.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Забыть', style: 'destructive', onPress: forgetRing },
    ]);

  const wipe = () =>
    Alert.alert(
      'Очистить данные?',
      'Будут удалены данные, история, биометрия и логи. Сон за прошлые дни с кольца восстановить, возможно, не получится. Продолжить?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Очистить',
          style: 'destructive',
          onPress: () => {
            clearData();
            setDraft(EMPTY_PROFILE);
          },
        },
      ],
    );

  const onVersion = () => {
    const next = taps + 1;
    setTaps(next);
    if (next >= 5) {
      setTaps(0);
      router.push('/raw-log');
    }
  };

  if (about) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xl }}>
        <Pressable onPress={() => setAbout(false)} hitSlop={10} style={styles.back}>
          <Text style={styles.action}>Назад</Text>
        </Pressable>
        <Text style={styles.title}>О приложении</Text>
        <Card>
          <Text style={styles.note}>{DISCLAIMER}</Text>
          <Pressable onPress={onVersion} style={styles.versionRow}>
            <Text style={styles.version}>Версия {version}</Text>
          </Pressable>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xl }}>
      <Text style={styles.title}>Профиль</Text>

      <Card>
        <View style={styles.line}>
          <Text style={styles.label}>Заряд кольца</Text>
          <Text style={[styles.value, battery.stale && styles.stale]}>
            {state.battery === null ? '—' : `${state.battery} %${battery.time ? ` · ${battery.time}` : ''}`}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.label}>Синхронизация</Text>
          <Text style={styles.value}>{statusText.replace('Обновлено ', '')}</Text>
        </View>
      </Card>

      <Card title="Биометрия">
        <View style={styles.line}>
          <Text style={styles.label}>Пол</Text>
          <View style={styles.chips}>
            {SEX.map((s) => (
              <Pressable key={s.id} onPress={() => commit({ sex: s.id })} style={[styles.chip, draft.sex === s.id && styles.chipOn]}>
                <Text style={[styles.chipText, draft.sex === s.id && styles.chipTextOn]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Field label="Рост, см" value={draft.heightCm} onChange={(t) => number(t, 'heightCm')} onBlur={() => blur('heightCm')} />
        <Field label="Вес, кг" value={draft.weightKg} onChange={(t) => number(t, 'weightKg')} onBlur={() => blur('weightKg')} />
        <Field label="Год рождения" value={draft.birthYear} onChange={(t) => number(t, 'birthYear')} onBlur={() => blur('birthYear')} />
        {profileAge(draft) !== null ? <Text style={styles.note}>Возраст {profileAge(draft)}</Text> : null}
      </Card>

      <Card title="Кольцо">
        <View style={styles.line}>
          <Text style={styles.label}>Частота автозамеров</Text>
          <View style={styles.chips}>
            {AUTO_MEASURE_PERIODS.map((m: AutoMeasurePeriod) => (
              <Pressable
                key={m}
                onPress={() => setAutoMeasure(m)}
                style={[styles.chip, state.autoMeasureMin === m && styles.chipOn]}
              >
                <Text style={[styles.chipText, state.autoMeasureMin === m && styles.chipTextOn]}>{m}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.note}>Чаще замеры, быстрее садится батарея</Text>
      </Card>

      <Card title="Цель">
        {GOALS.map((g) => (
          <Pressable key={g.id} onPress={() => commit({ goal: g.id })} style={styles.goal}>
            <Text style={[styles.goalText, draft.goal === g.id && styles.goalTextOn]}>{g.label}</Text>
            {draft.goal === g.id ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        ))}
      </Card>

      <Card>
        <Pressable style={styles.line} onPress={() => setAbout(true)}>
          <Text style={styles.label}>О приложении</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable style={styles.line} onPress={forget}>
          <Text style={styles.danger}>Забыть кольцо</Text>
        </Pressable>
        <Pressable style={styles.line} onPress={wipe}>
          <Text style={styles.label}>Очистить данные</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const valid = (key: 'heightCm' | 'weightKg' | 'birthYear', value: number): boolean => {
  if (key === 'heightCm') return value >= PROFILE_LIMITS.heightCm.min && value <= PROFILE_LIMITS.heightCm.max;
  if (key === 'weightKg') return value >= PROFILE_LIMITS.weightKg.min && value <= PROFILE_LIMITS.weightKg.max;
  const age = new Date().getFullYear() - value;
  return age >= PROFILE_LIMITS.age.min && age <= PROFILE_LIMITS.age.max;
};

function Field({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: number | null;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={value === null ? '' : String(value)}
        onChangeText={onChange}
        onBlur={onBlur}
        placeholder="—"
        placeholderTextColor={colors.textFaint}
        maxLength={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 28, fontWeight: '600', paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  back: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  action: { color: colors.accent, fontSize: 16 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 15, flex: 1 },
  value: { color: colors.text, fontSize: 15 },
  stale: { color: colors.textFaint },
  input: { color: colors.text, fontSize: 16, minWidth: 64, textAlign: 'right', paddingVertical: 2 },
  chips: { flexDirection: 'row', gap: spacing.xs },
  chip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.track },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 14 },
  chipTextOn: { color: colors.bg, fontWeight: '600' },
  goal: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  goalText: { color: colors.textMuted, fontSize: 15, flex: 1 },
  goalTextOn: { color: colors.text },
  check: { color: colors.accent, fontSize: 16 },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: spacing.xs },
  danger: { color: '#E5705F', fontSize: 15 },
  chevron: { color: colors.textFaint, fontSize: 22 },
  versionRow: { paddingVertical: spacing.lg },
  version: { color: colors.textFaint, fontSize: 13 },
});
