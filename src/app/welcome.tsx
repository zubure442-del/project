import { router } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canLeave, loadProgress, nextShownStage, shownPercent, useVuelo, type ShownStage } from '../state';
import { ProgressArc, colors, radius, spacing } from '../ui';

/** Границы приветствия по времени суток. */
export const GREETINGS = [
  { fromHour: 5, until: 12, text: 'Доброе утро' },
  { fromHour: 12, until: 17, text: 'Добрый день' },
  { fromHour: 17, until: 23, text: 'Добрый вечер' },
] as const;
export const GREETING_NIGHT = 'Доброй ночи';


export function greeting(now = new Date(), name?: string | null): string {
  const h = now.getHours();
  const base = GREETINGS.find((g) => h >= g.fromHour && h < g.until)?.text ?? GREETING_NIGHT;
  return name ? `${base}, ${name}` : base;
}


/** Три разные беды — три разных текста. В заголовке суть, в тексте только что делать. */
const PROBLEMS = {
  'not-found': {
    title: 'Кольцо не найдено',
    text:
      'Наденьте кольцо и поднесите ближе к телефону. Если оно уже подключено к этому iPhone или к другому ' +
      'телефону, откройте Настройки → Bluetooth, нажмите ⓘ рядом с кольцом и выберите «Забыть это устройство».',
  },
  lost: {
    title: 'Связь оборвалась',
    text: 'Кольцо пропало на середине загрузки. Поднесите его ближе к телефону и попробуйте снова.',
  },
  slow: {
    title: 'Кольцо отвечает слишком медленно',
    text: 'Данные идут, но очень медленно. Держите телефон рядом с кольцом или попробуйте позже.',
  },
} as const;

/** Смена фразы: сперва старая гаснет, только потом появляется новая. */
const STATUS_FADE_MS = 150;

function useDelayedText(text: string) {
  const [state, setState] = useState({ shown: text, visible: true });
  const pending = useRef(text);

  useEffect(() => {
    if (text === pending.current) return;
    pending.current = text;
    setState((prev) => ({ ...prev, visible: false }));
    const timer = setTimeout(() => setState({ shown: text, visible: true }), STATUS_FADE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return state;
}

const STAGE_TEXT = ['Подключаемся к кольцу', 'Забираем данные', 'Считаем показатели', 'Собираем итог'] as const;

const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function Welcome() {
  const { state, phase, error, sync, markStarted, loadingMode } = useVuelo();
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const real = useSyncExternalStore(loadProgress.subscribe, loadProgress.get);
  const [shown, setShown] = useState<ShownStage>(() => ({ stage: 1, since: Date.now() }));
  const [percent, setPercent] = useState(0);
  const shownRef = useRef(shown);
  const percentRef = useRef(0);
  const needsStart = !state.started;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Этапы идут за реальными событиями, но каждый висит на экране не меньше положенного.
  useEffect(() => {
    if (needsStart || phase === 'failed') return;
    const timer = setInterval(() => {
      const now = Date.now();
      const progress = loadProgress.get();
      const next = nextShownStage(shownRef.current, progress, now);
      if (next !== shownRef.current) setShown((shownRef.current = next));
      const p = shownPercent(percentRef.current, next, progress);
      if (p !== percentRef.current) setPercent((percentRef.current = p));
      if (phase === 'done' && canLeave(next, progress, now)) {
        clearInterval(timer);
        leave();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [needsStart, phase]);

  const problem = phase === 'failed' ? PROBLEMS[error ?? 'not-found'] : null;
  const status = useDelayedText(`${STAGE_TEXT[shown.stage - 1]} · шаг ${shown.stage} из 4`);

  if (problem) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.body}>
          <Text style={styles.title}>{problem.title}</Text>
          <Text style={styles.message}>{problem.text}</Text>
          <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text style={styles.link}>Открыть настройки Bluetooth</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.button}
          onPress={() => sync('retry')}
        >
          <Text style={styles.buttonText}>Повторить</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={leave}>
          <Text style={styles.secondaryText}>Открыть с сохранёнными данными</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={{ height: insets.top + spacing.xl }} />
      <Animated.Text entering={FadeIn.duration(600)} style={styles.greeting}>
        {/* При обновлении по запросу приветствие не показываем: это не новый вход. */}
        {loadingMode === 'refresh' && !needsStart ? 'Обновляем данные' : greeting(new Date(), state.profile.name)}
      </Animated.Text>

      <View style={styles.center}>
        <ProgressArc
          size={168}
          progress={needsStart ? 0 : percent}
          pulse={real.packets}
          breathing={!needsStart && phase === 'loading'}
          reduceMotion={reduceMotion}
          showLogo
        />
        {needsStart ? null : (
          <View style={styles.stage}>
            <Animated.Text style={[styles.stageText, { opacity: status.visible ? 1 : 0 }]}>
              {status.shown}
            </Animated.Text>
          </View>
        )}
      </View>

      {needsStart ? (
        <Pressable
          style={styles.button}
          onPress={() => markStarted(null)}
        >
          <Text style={styles.buttonText}>Начать</Text>
        </Pressable>
      ) : null}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.note}>Bluetooth нужен для связи с кольцом. Данные остаются на телефоне</Text>
        <Text style={styles.note}>Не медицинский прибор. Показатели носят справочный характер</Text>
      </View>
    </View>
  );
}

/** Плашка «Данные актуальны» на две секунды. */
export function FreshBadge({ onDone }: { onDone: () => void }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 300 });
      setTimeout(onDone, 300);
    }, 1700);
    return () => clearTimeout(timer);
  }, [onDone, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.fresh, style]} pointerEvents="none">
      <Text style={styles.freshText}>Данные актуальны</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  greeting: { color: colors.text, fontSize: 34, fontWeight: '200', letterSpacing: 0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  stage: { alignItems: 'center', gap: spacing.xs, height: 46 },
  stageText: { color: colors.textMuted, fontSize: 16, fontVariant: ['tabular-nums'] },
  slow: { color: colors.textFaint, fontSize: 13 },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '600' },
  message: { color: colors.textMuted, fontSize: 16, lineHeight: 24 },
  link: { color: colors.accent, fontSize: 16, marginTop: spacing.xs },
  button: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { color: colors.textMuted, fontSize: 15 },
  footer: { gap: 4, paddingTop: spacing.lg },
  note: { color: colors.textFaint, fontSize: 12, textAlign: 'center' },
  fresh: {
    position: 'absolute',
    alignSelf: 'center',
    top: 8,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  freshText: { color: colors.textMuted, fontSize: 13 },
});
