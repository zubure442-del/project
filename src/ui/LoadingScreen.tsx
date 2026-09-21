import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  STAGE_COUNT,
  STAGE_FADE_MS,
  canLeave,
  loadProgress,
  nextShownStage,
  shownPercent,
  useVuelo,
  type ShownStage,
} from '../state';
import { StageArt } from './LoadingArt';
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
    title: 'Считаем показатели',
    lines: [
      { icon: 'split', text: 'Сон, активность и состояние организма считаются отдельно' },
      { icon: 'total', text: 'Итог появляется, когда есть все три' },
    ],
  },
  {
    title: 'Собираем итог',
    lines: [
      { icon: 'phone', text: 'Данные остаются на телефоне' },
      { icon: 'info', text: 'Приложение не заменяет врача' },
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

/** Карточка с подсказками: смена — затуханием, без свайпа. */
function TipsCard({ stage, percent, pulse, reduceMotion }: { stage: number; percent: number; pulse: number; reduceMotion: boolean }) {
  const [content, setContent] = useState(stage);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (stage === content || reduceMotion) return;
    opacity.value = withTiming(0, { duration: STAGE_FADE_MS });
    const timer = setTimeout(() => {
      setContent(stage);
      opacity.value = withTiming(1, { duration: STAGE_FADE_MS });
    }, STAGE_FADE_MS);
    return () => clearTimeout(timer);
  }, [content, opacity, reduceMotion, stage]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // При «Уменьшении движения» карточка меняется сразу, без затухания.
  const tip = LOADING_TIPS[(reduceMotion ? stage : content) - 1];

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
        <Text style={styles.progressText} numberOfLines={1}>
          Синхронизация…
        </Text>
        <Text style={styles.progressStep}>
          Шаг {stage} из {STAGE_COUNT}
        </Text>
      </View>
    </View>
  );
}

/** Ход загрузки: этапы идут за реальными событиями, но каждый висит не меньше положенного. */
function SyncStages({ onFinish }: { onFinish: () => void }) {
  const { phase } = useVuelo();
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState<ShownStage>(() => ({ stage: 1, since: Date.now() }));
  const [percent, setPercent] = useState(0);
  const [pulse, setPulse] = useState(0);
  const shownRef = useRef(shown);
  const percentRef = useRef(0);
  const flash = useRef({ packets: 0, at: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const real = loadProgress.get();
      const next = nextShownStage(shownRef.current, real, now);
      if (next !== shownRef.current) setShown((shownRef.current = next));
      const p = shownPercent(percentRef.current, next, real);
      if (p !== percentRef.current) setPercent((percentRef.current = p));
      if (real.packets !== flash.current.packets && now - flash.current.at >= FLASH_MS) {
        flash.current = { packets: real.packets, at: now };
        setPulse(real.packets);
      }
      if (phase === 'done' && canLeave(next, real, now)) {
        clearInterval(timer);
        onFinish();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [onFinish, phase]);

  const fade = reduceMotion ? 0 : STAGE_FADE_MS;
  return (
    <>
      <View style={styles.art}>
        <StageArt stage={shown.stage} fadeMs={fade} />
      </View>
      <TipsCard stage={shown.stage} percent={percent} pulse={pulse} reduceMotion={reduceMotion} />
    </>
  );
}

/** Самый первый запуск: как обращаться. Bluetooth спрашиваем только после нажатия. */
function NameForm({ onDone }: { onDone: (name: string | null) => void }) {
  const [name, setName] = useState('');
  return (
    <KeyboardAvoidingView style={styles.nameRoot} behavior="padding">
      <Text style={styles.greeting}>Привет!</Text>
      <Text style={styles.nameQuestion}>Как к вам обращаться?</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Имя"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        autoFocus
        maxLength={24}
        returnKeyType="done"
        onSubmitEditing={() => onDone(name)}
      />
      <Pressable style={styles.button} onPress={() => onDone(name)}>
        <Text style={styles.buttonText}>Продолжить</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => onDone(null)}>
        <Text style={styles.secondaryText}>Пропустить</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

/**
 * Экран загрузки поверх вкладок. Единственное место, где видно синхронизацию:
 * вход, возврат из фона, pull-to-refresh и «Повторить» открывают его одинаково.
 */
export function LoadingScreen() {
  const { state, phase, error, loadingMode, sync, markStarted, finishLoading } = useVuelo();
  const insets = useSafeAreaInsets();
  const frame = { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.sm };

  if (!state.started) {
    return (
      <View style={[styles.root, frame]}>
        <NameForm onDone={markStarted} />
      </View>
    );
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
      <SyncStages onFinish={finishLoading} />
      <View style={styles.footer}>
        <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          Данные хранятся только на телефоне
        </Text>
        <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          Не медицинский прибор · показатели справочные
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
  progress: { alignItems: 'center', width: 104, gap: 4 },
  progressText: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  progressStep: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  footer: { gap: 2, paddingTop: spacing.md, alignItems: 'center' },
  note: { color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  nameRoot: { flex: 1, justifyContent: 'center', gap: spacing.md },
  nameQuestion: { color: colors.textMuted, fontSize: 20, fontWeight: '300', paddingHorizontal: spacing.xs },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    color: colors.text,
    fontSize: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginTop: spacing.sm,
  },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '600' },
  message: { color: colors.textMuted, fontSize: 16, lineHeight: 24 },
  link: { color: colors.accent, fontSize: 16, marginTop: spacing.xs },
  button: { backgroundColor: colors.accent, borderRadius: radius.card, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { color: colors.textMuted, fontSize: 15 },
});
