import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EMPTY_DRAFT, NAME_NOTE, onboardingProfile, type OnboardingDraft } from '../state';
import type { Goal, Profile, Sex } from '../storage';
import { Logo } from './Logo';
import { colors, radius, spacing } from './theme';

const SEX: { id: Sex; label: string }[] = [
  { id: 'male', label: 'Мужской' },
  { id: 'female', label: 'Женский' },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: 'lose', label: 'Похудение' },
  { id: 'gain', label: 'Набор мышечной массы' },
  { id: 'keep', label: 'Поддержание формы' },
];
const NUMBERS = [
  { key: 'heightCm', label: 'Рост, см', max: 3 },
  { key: 'weightKg', label: 'Вес, кг', max: 3 },
  { key: 'birthYear', label: 'Год рождения', max: 4 },
] as const;

/** Первый экран первого запуска: только логотип и «Начать». */
function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.welcome}>
      <View style={styles.logo}>
        <Logo size={96} />
      </View>
      <Pressable style={styles.button} onPress={onStart}>
        <Text style={styles.buttonText}>Начать</Text>
      </Pressable>
    </View>
  );
}

/** Одна форма со всеми обязательными полями. Пропустить нельзя; Bluetooth — только после отправки. */
function ProfileForm({ onDone }: { onDone: (profile: Profile) => void }) {
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const set = (patch: Partial<OnboardingDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const profile = onboardingProfile(draft);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>О вас</Text>

        <Text style={styles.label}>Имя</Text>
        <TextInput
          style={styles.input}
          value={draft.name}
          onChangeText={(name) => set({ name })}
          placeholder="Как к вам обращаться"
          placeholderTextColor={colors.textFaint}
          maxLength={24}
        />
        <Text style={styles.note}>{NAME_NOTE}</Text>

        <Text style={styles.label}>Пол</Text>
        <View style={styles.row}>
          {SEX.map((s) => (
            <Pressable key={s.id} onPress={() => set({ sex: s.id })} style={[styles.chip, draft.sex === s.id && styles.chipOn]}>
              <Text style={[styles.chipText, draft.sex === s.id && styles.chipTextOn]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.row}>
          {NUMBERS.map((f) => (
            <View key={f.key} style={styles.flex}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={draft[f.key]}
                onChangeText={(t) => set({ [f.key]: t.replace(/\D/g, '') })}
                maxLength={f.max}
                placeholder="—"
                placeholderTextColor={colors.textFaint}
              />
            </View>
          ))}
        </View>

        <Text style={styles.label}>Цель</Text>
        {GOALS.map((g) => (
          <Pressable key={g.id} onPress={() => set({ goal: g.id })} style={[styles.goal, draft.goal === g.id && styles.goalOn]}>
            <Text style={[styles.goalText, draft.goal === g.id && styles.goalTextOn]}>{g.label}</Text>
          </Pressable>
        ))}

        <Pressable
          style={[styles.button, styles.submit, !profile && styles.buttonOff]}
          disabled={!profile}
          onPress={() => profile && onDone(profile)}
        >
          <Text style={styles.buttonText}>Готово</Text>
        </Pressable>
        {!profile ? <Text style={styles.hint}>Заполните все поля</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Первый запуск: логотип с «Начать», потом форма со всеми обязательными полями сразу. */
export function Onboarding({ onDone }: { onDone: (profile: Profile) => void }) {
  const [step, setStep] = useState<'welcome' | 'form'>('welcome');
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      {step === 'welcome' ? <Welcome onStart={() => setStep('form')} /> : <ProfileForm onDone={onDone} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.md },
  flex: { flex: 1 },
  welcome: { flex: 1, justifyContent: 'flex-end' },
  logo: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  form: { paddingBottom: spacing.xl, gap: spacing.xs },
  title: { color: colors.text, fontSize: 30, fontWeight: '300', marginBottom: spacing.sm },
  label: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, paddingVertical: 12, borderRadius: radius.card, backgroundColor: colors.card, alignItems: 'center' },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 16 },
  chipTextOn: { color: colors.bg, fontWeight: '600' },
  goal: { paddingVertical: 14, paddingHorizontal: spacing.md, borderRadius: radius.card, backgroundColor: colors.card },
  goalOn: { backgroundColor: colors.accent },
  goalText: { color: colors.textMuted, fontSize: 16 },
  goalTextOn: { color: colors.bg, fontWeight: '600' },
  button: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center' },
  buttonOff: { opacity: 0.4 },
  submit: { marginTop: spacing.lg },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  hint: { color: colors.textFaint, fontSize: 13, textAlign: 'center', marginTop: spacing.xs },
});
