import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVuelo } from '../state';
import { ProgressArc, colors, radius, spacing } from '../ui';

/** Границы приветствия по времени суток. */
export const GREETINGS = [
  { fromHour: 5, until: 12, text: 'Доброе утро' },
  { fromHour: 12, until: 17, text: 'Добрый день' },
  { fromHour: 17, until: 23, text: 'Добрый вечер' },
] as const;
export const GREETING_NIGHT = 'Доброй ночи';

/** Приветствие висит хотя бы столько, даже если данные пришли мгновенно. */
const MIN_VISIBLE_MS = 1200;
/** Не дождались первой фазы — показываем, что делать. */
const GIVE_UP_MS = 20000;
/** Кольцо давно молчит — предупреждаем, но продолжаем ждать. */
const SLOW_MS = 8000;

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return GREETINGS.find((g) => h >= g.fromHour && h < g.until)?.text ?? GREETING_NIGHT;
}

const STAGE_TEXT = { connecting: 'Ищем кольцо', configuring: 'Настраиваем', loading: 'Загружаем данные' } as const;

const NOT_FOUND =
  'Кольцо не найдено. Наденьте его и поднесите ближе к телефону. Если кольцо уже подключено к этому iPhone ' +
  'или к другому телефону, откройте Настройки → Bluetooth, нажмите ⓘ рядом с кольцом и выберите ' +
  '«Забыть это устройство».';

export default function Welcome() {
  const { state, phase, stage, progress, packets, error, sync, markStarted } = useVuelo();
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [slow, setSlow] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const shownAt = useRef(0);
  const lastPacket = useRef(0);
  const needsStart = !state.started && !state.days.length;

  useEffect(() => {
    shownAt.current = Date.now();
    lastPacket.current = Date.now();
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Пакеты приходят часто: отметку держим в ref, состояние трогаем раз в секунду по таймеру.
  useEffect(() => {
    lastPacket.current = Date.now();
  }, [packets]);

  useEffect(() => {
    if (needsStart) return;
    const timer = setInterval(() => {
      setSlow(Date.now() - lastPacket.current > SLOW_MS);
      if (Date.now() - shownAt.current > GIVE_UP_MS) setGaveUp(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [needsStart]);

  // Первая фаза закончилась — уходим на главный экран, но не раньше, чем приветствие успели увидеть.
  useEffect(() => {
    if (needsStart || (phase !== 'background' && phase !== 'done')) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current));
    const timer = setTimeout(() => router.replace('/'), wait);
    return () => clearTimeout(timer);
  }, [needsStart, phase]);

  const failed = gaveUp || phase === 'failed';
  const open = () => router.replace('/');

  if (failed) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.body}>
          <Text style={styles.title}>Кольцо не найдено</Text>
          <Text style={styles.message}>{error && !gaveUp ? error : NOT_FOUND}</Text>
          <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text style={styles.link}>Открыть настройки Bluetooth</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.button}
          onPress={() => {
            setGaveUp(false);
            setSlow(false);
            shownAt.current = Date.now();
            sync();
          }}
        >
          <Text style={styles.buttonText}>Повторить</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={open}>
          <Text style={styles.secondaryText}>Открыть с сохранёнными данными</Text>
        </Pressable>
      </View>
    );
  }

  const percent = stage === 'loading' ? ` · ${String(Math.round(progress * 100)).padStart(2, ' ')} %` : '';

  return (
    <Pressable style={styles.root} onPress={needsStart ? undefined : open}>
      <View style={{ height: insets.top + spacing.xl }} />
      <Animated.Text entering={FadeIn.duration(600)} style={styles.greeting}>
        {greeting()}
      </Animated.Text>

      <View style={styles.center}>
        <ProgressArc
          size={168}
          progress={needsStart ? 0 : progress}
          pulse={packets}
          breathing={!needsStart && phase === 'first'}
          reduceMotion={reduceMotion}
          showLogo
        />
        {needsStart ? null : (
          <View style={styles.stage}>
            <Animated.Text key={stage ?? 'wait'} entering={FadeIn.duration(280)} exiting={FadeOut.duration(200)} style={styles.stageText}>
              {stage ? `${STAGE_TEXT[stage]}${percent}` : 'Готовим данные'}
            </Animated.Text>
            {slow ? (
              <Animated.Text entering={FadeIn.duration(280)} style={styles.slow}>
                Кольцо отвечает медленно…
              </Animated.Text>
            ) : null}
          </View>
        )}
      </View>

      {needsStart ? (
        <Pressable
          style={styles.button}
          onPress={() => {
            markStarted();
            shownAt.current = Date.now();
            sync();
          }}
        >
          <Text style={styles.buttonText}>Начать</Text>
        </Pressable>
      ) : null}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.note}>Bluetooth нужен для связи с кольцом. Данные остаются на телефоне</Text>
        <Text style={styles.note}>Не медицинский прибор. Показатели носят справочный характер</Text>
      </View>
    </Pressable>
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
