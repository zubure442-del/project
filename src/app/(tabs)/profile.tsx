import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOT_MEDICAL_DEVICE } from '../../domain';
import { BATTERY_STALE_MS, NAME_NOTE, parseProfileNumber, profileAlerts, useVuelo } from '../../state';
import { profileAge, type Goal, type Profile, type Sex } from '../../storage';
import { Card, colors, radius, spacing } from '../../ui';

const DISCLAIMER =
  `${NOT_MEDICAL_DEVICE}. Показатели носят справочный характер и не заменяют врача. ` +
  'Давление и глюкоза — оценка кольца. Данные хранятся только на этом телефоне. ' +
  'Для «Мнения Лиса» в YandexGPT уходят только две короткие фразы о самочувствии, которые приложение вывело из данных кольца, — без имени, биометрии и чисел; нигде не сохраняются.';

const SEX: { id: Sex; label: string }[] = [
  { id: 'male', label: 'М' },
  { id: 'female', label: 'Ж' },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: 'lose', label: 'Похудение' },
  { id: 'gain', label: 'Набор мышечной массы' },
  { id: 'keep', label: 'Поддержание формы' },
];

type TextKey = 'name' | 'heightCm' | 'weightKg' | 'birthYear';

export default function ProfileTab() {
  const { state, statusText, saveProfile, reloadProfile, forgetRing, clearData } = useVuelo();
  const insets = useSafeAreaInsets();
  const [about, setAbout] = useState(false);
  const [taps, setTaps] = useState(0);
  // Профиль — из общего состояния; локально только текст поля, которое сейчас правят.
  // Раньше здесь была копия профиля с момента открытия вкладки, и она затирала имя из первого запуска.
  const profile = state.profile;
  const [edits, setEdits] = useState<Partial<Record<TextKey, string>>>({});
  const { missing } = profileAlerts(profile);
  useFocusEffect(useCallback(() => reloadProfile(), [reloadProfile]));
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
    setEdits((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[key as TextKey];
      return next;
    });
    saveProfile(patch);
  };

  const text = (key: TextKey) => edits[key] ?? (profile[key] === null ? '' : String(profile[key]));
  const edit = (key: TextKey, value: string) => {
    if (key === 'name') {
      setEdits((prev) => ({ ...prev, name: value }));
      return;
    }
    const digits = value.replace(/\D/g, '');
    setEdits((prev) => ({ ...prev, [key]: digits }));
    // Верное значение сохраняем сразу, не дожидаясь ухода из поля: при переходе на другую
    // вкладку «уход из поля» может не случиться, и год рождения терялся.
    const parsed = parseProfileNumber(key, digits);
    if (parsed !== null && parsed !== profile[key]) saveProfile({ [key]: parsed });
  };

  const blur = (key: 'heightCm' | 'weightKg' | 'birthYear') => {
    if (edits[key] === undefined) return;
    commit({ [key]: parseProfileNumber(key, edits[key] ?? '') });
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
            setEdits({});
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

      <Card title="Имя">
        <TextInput
          style={styles.nameInput}
          value={text('name')}
          onChangeText={(t) => edit('name', t)}
          onBlur={() => commit({ name: edits.name === undefined ? profile.name : edits.name.trim() || null })}
          placeholder="Как к вам обращаться"
          placeholderTextColor={colors.textFaint}
          maxLength={24}
        />
        <Text style={styles.small}>{NAME_NOTE}</Text>
      </Card>

      {missing.size ? <Text style={styles.required}>Для корректной работы заполните эти поля</Text> : null}

      <Card title="Биометрия">
        <View style={styles.line}>
          <Text style={[styles.label, missing.has('sex') && styles.labelMissing]}>Пол</Text>
          <View style={[styles.chips, missing.has('sex') && styles.missingBox]}>
            {SEX.map((s) => (
              <Pressable key={s.id} onPress={() => commit({ sex: s.id })} style={[styles.chip, profile.sex === s.id && styles.chipOn]}>
                <Text style={[styles.chipText, profile.sex === s.id && styles.chipTextOn]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {(['heightCm', 'weightKg', 'birthYear'] as const).map((key) => (
          <Field
            key={key}
            label={FIELD_LABEL[key]}
            value={text(key)}
            missing={missing.has(key)}
            onChange={(t) => edit(key, t)}
            onBlur={() => blur(key)}
          />
        ))}
        {profileAge(profile) !== null ? <Text style={styles.note}>Возраст {profileAge(profile)}</Text> : null}
      </Card>

      <Card title="Цель">
        <View style={missing.has('goal') && styles.missingBox}>
          {GOALS.map((g) => (
            <Pressable key={g.id} onPress={() => commit({ goal: g.id })} style={styles.goal}>
              <Text style={[styles.goalText, profile.goal === g.id && styles.goalTextOn]}>{g.label}</Text>
              {profile.goal === g.id ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          ))}
        </View>
        {missing.has('goal') ? <Text style={styles.missingNote}>Цель не выбрана</Text> : null}
      </Card>

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

const FIELD_LABEL = { heightCm: 'Рост, см', weightKg: 'Вес, кг', birthYear: 'Год рождения' } as const;

/** Числовое поле биометрии. Пустое обязательное — красная рамка и красная подпись. */
function Field({
  label,
  value,
  missing,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  missing: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.label, missing && styles.labelMissing]}>{label}</Text>
      <TextInput
        style={[styles.input, missing && styles.missingBox]}
        keyboardType="number-pad"
        value={value}
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
  input: {
    color: colors.text,
    fontSize: 16,
    minWidth: 72,
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  nameInput: { color: colors.text, fontSize: 18, paddingVertical: spacing.xs },
  small: { color: colors.textFaint, fontSize: 12, lineHeight: 16, marginTop: spacing.xs },
  required: { color: colors.danger, fontSize: 14, paddingHorizontal: spacing.md, marginTop: spacing.md },
  labelMissing: { color: colors.danger },
  missingBox: { borderWidth: 1, borderColor: colors.danger, borderRadius: 8 },
  missingNote: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
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
  danger: { color: colors.danger, fontSize: 15 },
  chevron: { color: colors.textFaint, fontSize: 22 },
  versionRow: { paddingVertical: spacing.lg },
  version: { color: colors.textFaint, fontSize: 13 },
});
