import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVuelo } from '../state';
import { Logo, colors, radius, spacing } from '../ui';

const STEPS = [
  {
    title: 'Vuelo',
    text: 'Наденьте кольцо и полностью закройте официальное приложение кольца — оно держит связь только с одним приложением.',
    button: 'Дальше',
  },
  {
    title: 'Bluetooth',
    text: 'Данные приходят с кольца по Bluetooth. Сейчас телефон спросит разрешение — без него кольцо не найдётся.',
    button: 'Понятно',
  },
  {
    title: 'Важно',
    text: 'Vuelo показывает то, что измерило кольцо. Это не медицинский прибор: приложение не ставит диагнозов и не даёт медицинских рекомендаций. Давление и глюкозу кольцо оценивает по пульсовой волне, а не измеряет.',
    button: 'Понятно',
  },
];

export default function Onboarding() {
  const { finishOnboarding } = useVuelo();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    finishOnboarding();
    router.replace('/');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.body}>
        <Logo size={56} />
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.text}>{current.text}</Text>
      </View>
      <View style={styles.dots}>
        {STEPS.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === step && styles.dotOn]} />
        ))}
      </View>
      <Pressable style={styles.button} onPress={next}>
        <Text style={styles.buttonText}>{current.button}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: 32, fontWeight: '600', marginTop: spacing.md },
  text: { color: colors.textMuted, fontSize: 17, lineHeight: 26 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: spacing.lg },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.track },
  dotOn: { backgroundColor: colors.accent },
  button: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
});
