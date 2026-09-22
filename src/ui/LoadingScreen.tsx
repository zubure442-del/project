import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOT_MEDICAL_DEVICE } from '../domain';
import {
  STAGE_FADE_MS,
  canLeave,
  loadProgress,
  nextSlide,
  plannedPercent,
  slideCaption,
  statusText,
  useVuelo,
  type LoadProgress,
  type ShownSlide,
} from '../state';
import { StageArt } from './LoadingArt';
import { Onboarding } from './Onboarding';
import { ProgressArc } from './ProgressArc';
import { TipGlyph, type TipIcon } from './TipIcons';
import { colors, radius, spacing } from './theme';

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

/** Карточка каждого этапа: заголовок и строки с иконками. */
export const LOADING_TIPS: { title: string; lines: { icon: TipIcon; text: string }[] }[] = [
  {
    title: 'Как правильно носить кольцо',
    lines: [
      { icon: 'finger', text: 'На указательном или среднем пальце' },
      { icon: 'sensor', text: 'Датчиками внутрь ладони' },
      { icon: 'fit', text: 'Плотное комфортное прилегание' },
    ],
  },
  {
    title: 'Забираем данные',
    lines: [
      { icon: 'pulse', text: 'Кольцо мерит пульс, стресс и кислород каждые 30 минут' },
      { icon: 'moon', text: 'Сон записывается, пока вы носите кольцо ночью' },
    ],
  },
  {
    // Рисунок: кольцо раскладывается на три кольца — три показателя дня.
    title: 'Три показателя дня',
    lines: [
      { icon: 'moon', text: 'Сон — сколько и насколько глубоко вы спали' },
      { icon: 'steps', text: 'Активность — шаги и нагрузка за день' },
      { icon: 'heart', text: 'Организм — пульс, вариабельность и кислород' },
    ],
  },
  {
    // Рисунок: кольцо с AI-чипом собирает данные в итог.
    title: 'Персональный совет',
    lines: [
      { icon: 'total', text: 'Итог дня складывается из всех трёх показателей' },
      { icon: 'spark', text: 'Совет — о том, что сегодня проседает сильнее всего' },
      { icon: 'phone', text: 'Всё считается на телефоне, данные никуда не уходят' },
    ],
  },
];

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
    text: 'Держите телефон рядом с кольцом или попробуйте позже.',
  },
} as const;

/** Как часто экран сверяется с реальным ходом загрузки. */
const TICK_MS = 100;
/** Блик по дуге — не чаще четырёх раз в секунду. */
const FLASH_MS = 250;

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

interface CardProps {
  slide: number;
  percent: number;
  pulse: number;
  status: string;
  caption: string;
  reduceMotion: boolean;
}

/** Карточка с подсказками: листается по таймеру, смена — затуханием, без свайпа. */
function TipsCard({ slide, percent, pulse, status, caption, reduceMotion }: CardProps) {
  const [content, setContent] = useState(slide);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (slide === content || reduceMotion) return;
    opacity.value = withTiming(0, { duration: STAGE_FADE_MS });
    const timer = setTimeout(() => {
      setContent(slide);
      opacity.value = withTiming(1, { duration: STAGE_FADE_MS });
    }, STAGE_FADE_MS);
    return () => clearTimeout(timer);
  }, [content, opacity, reduceMotion, slide]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // При «Уменьшении движения» карточка меняется сразу, без затухания.
  const tip = LOADING_TIPS[(reduceMotion ? slide : content) - 1];

  return (
    <View style={styles.card}>
      <Animated.View style={[styles.tips, style]}>
        <Text style={styles.tipTitle}>{tip.title}</Text>
        {tip.lines.map((line) => (
          <View key={line.text} style={styles.tipRow}>
            <TipGlyph name={line.icon} />
            <Text style={styles.tipText}>{line.text}</Text>
          </View>
        ))}
      </Animated.View>
      <View style={styles.progress}>
        <ProgressArc size={72} progress={percent} pulse={pulse} breathing reduceMotion={reduceMotion} showLogo />
        <Text style={styles.progressText} numberOfLines={2}>
          {status}
        </Text>
        <Text style={styles.progressStep}>{caption}</Text>
      </View>
    </View>
  );
}

/**
 * Ход загрузки. Кольцо и статус — настоящие; карточки с рисунками листаются равными
 * интервалами и есть только у длинной загрузки. Быстрая — логотип с дугой и статус.
 */
function SyncView({ onFinish }: { onFinish: () => void }) {
  const { phase } = useVuelo();
  const reduceMotion = useReduceMotion();
  const [tick, setTick] = useState<{ p: LoadProgress; shown: ShownSlide }>(() => ({
    p: loadProgress.get(),
    shown: { slide: 1, since: Date.now() },
  }));
  const [percent, setPercent] = useState(0);
  const [pulse, setPulse] = useState(0);
  const flash = useRef({ packets: 0, at: 0 });
  const shownRef = useRef<ShownSlide>(tick.shown);
  const percentRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const p = loadProgress.get();
      // Процент — по ожидаемым длительностям частей загрузки; только растёт.
      const pct = Math.max(percentRef.current, plannedPercent(p, now));
      percentRef.current = pct;
      setPercent(pct);
      // Карточка — по четвертям процента, по одной и не чаще раза в SLIDE_MIN_MS.
      shownRef.current = nextSlide(shownRef.current, pct, now);
      setTick({ p, shown: shownRef.current });
      if (p.packets !== flash.current.packets && now - flash.current.at >= FLASH_MS) {
        flash.current = { packets: p.packets, at: now };
        setPulse(p.packets);
      }
      if (phase === 'done' && canLeave(p, shownRef.current, now)) {
        clearInterval(timer);
        onFinish();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [onFinish, phase]);

  const { p, shown } = tick;
  const status = statusText(p, percent);

  if (!p.slides) {
    return (
      <View style={styles.quick}>
        <ProgressArc size={168} progress={percent} pulse={pulse} breathing reduceMotion={reduceMotion} showLogo />
        <Text style={styles.quickStatus}>{status}</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.art}>
        <StageArt stage={shown.slide} fadeMs={reduceMotion ? 0 : STAGE_FADE_MS} />
      </View>
      <TipsCard
        slide={shown.slide}
        percent={percent}
        pulse={pulse}
        status={status}
        caption={slideCaption(shown, percent, p.finished)}
        reduceMotion={reduceMotion}
      />
    </>
  );
}

/**
 * Экран загрузки поверх вкладок. Единственное место, где видно синхронизацию:
 * вход, возврат из фона, pull-to-refresh и «Повторить» открывают его одинаково.
 */
export function LoadingScreen() {
  const { state, phase, error, loadingMode, sync, completeOnboarding, finishLoading } = useVuelo();
  const insets = useSafeAreaInsets();
  const frame = { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.sm };

  if (!state.started) {
    return <Onboarding onDone={completeOnboarding} />;
  }

  if (phase === 'failed') {
    const problem = PROBLEMS[error ?? 'not-found'];
    return (
      <View style={[styles.root, frame]}>
        <View style={styles.body}>
          <Text style={styles.title}>{problem.title}</Text>
          <Text style={styles.message}>{problem.text}</Text>
          <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text style={styles.link}>Открыть настройки Bluetooth</Text>
          </Pressable>
        </View>
        <Pressable style={styles.button} onPress={() => sync('retry')}>
          <Text style={styles.buttonText}>Повторить</Text>
        </Pressable>
        {state.days.length ? (
          <Pressable style={styles.secondary} onPress={finishLoading}>
            <Text style={styles.secondaryText}>Открыть с сохранёнными данными</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.root, frame]}>
      <Text style={styles.greeting} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {loadingMode === 'refresh' ? 'Обновляем данные' : greeting(new Date(), state.profile.name)}
      </Text>
      <SyncView onFinish={finishLoading} />
      <View style={styles.footer}>
        <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          Данные хранятся только на телефоне
        </Text>
        <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {NOT_MEDICAL_DEVICE} · показатели справочные
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.md },
  greeting: { color: colors.text, fontSize: 34, fontWeight: '200', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  art: { flex: 1, marginVertical: spacing.sm, marginHorizontal: -spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    minHeight: 168,
  },
  tips: { flex: 1, gap: spacing.sm },
  tipTitle: { color: colors.accent, fontSize: 15, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tipText: { color: colors.text, fontSize: 15, lineHeight: 20, flex: 1 },
  progress: { alignItems: 'center', width: 112, gap: 4 },
  progressText: { color: colors.textMuted, fontSize: 12, marginTop: 4, textAlign: 'center', fontVariant: ['tabular-nums'] },
  quick: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  quickStatus: { color: colors.textMuted, fontSize: 16, fontVariant: ['tabular-nums'] },
  progressStep: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  footer: { gap: 2, paddingTop: spacing.md, alignItems: 'center' },
  note: { color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '600' },
  message: { color: colors.textMuted, fontSize: 16, lineHeight: 24 },
  link: { color: colors.accent, fontSize: 16, marginTop: spacing.xs },
  button: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { color: colors.textMuted, fontSize: 15 },
});
