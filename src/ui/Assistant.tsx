import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ADVICE_LABEL, AUTOPHAGY_INFO, coffeeClock, type CoffeeWindow, type FoodCycle } from '../domain';
import type { AssistantSlide } from '../state/day';
import { InfoButton } from './Sheet';
import { SparkIcon } from './TabIcons';
import { useReduceMotion } from './motion';
import { colors, radius, spacing, withAlpha } from './theme';

/**
 * Высота карточки карусели. Подобрана так, чтобы на «Сегодня» она целиком помещалась
 * на экране вместе с маскотом: заходишь в приложение — и листать вниз не нужно.
 */
export const ASSISTANT_HEIGHT = 300;
/** Подпись-подсказка в правом нижнем углу карточки: дальше по свайпу — готовые подсказки. */
export const LIFEHACKS_LABEL = 'Лайфхаки';
/** Стрелка-подсказка качается туда-обратно. */
const NUDGE_MS = 700;
const NUDGE_PX = 4;
const ZONE_RED = withAlpha(colors.danger, 0.6);
const ZONE_GREEN = '#5DBB8C';

type Glyph = 'coffee' | 'food' | 'bolt' | 'moon';

function CardGlyph({ name }: { name: Glyph }) {
  const p = { stroke: colors.accent, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      {name === 'coffee' ? (
        <>
          <Path {...p} d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9z" />
          <Path {...p} d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5" />
        </>
      ) : name === 'food' ? (
        <>
          <Circle {...p} cx={12} cy={12} r={6.5} />
          <Path {...p} d="M3 4v6M5 4v16M19 4c-1.5 1-2 3-2 5s1 2 2 2v9" />
        </>
      ) : name === 'bolt' ? (
        <Path {...p} d="M13 3 5 13h6l-1 8 8-10h-6l1-8z" />
      ) : (
        <Path {...p} d="M15.5 3.5a8.5 8.5 0 1 0 5 12.7A7 7 0 0 1 15.5 3.5z" />
      )}
    </Svg>
  );
}

/**
 * «Лайфхаки ›» в правом нижнем углу первой карточки: подсказка, что карусель листается.
 * Стрелка мягко качается вправо; при системном «Уменьшении движения» стоит на месте.
 */
function SwipeHint() {
  const reduce = useReduceMotion();
  const shift = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      shift.value = 0;
      return;
    }
    shift.value = withRepeat(
      withSequence(withTiming(NUDGE_PX, { duration: NUDGE_MS }), withTiming(0, { duration: NUDGE_MS })),
      -1,
      false,
    );
  }, [reduce, shift]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  return (
    <View style={styles.hint}>
      <Text style={styles.hintText}>{LIFEHACKS_LABEL}</Text>
      <Animated.View style={style}>
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path
            d="M9 5l7 7-7 7"
            stroke={colors.accent}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

/**
 * Таймлайн суток: красная зона до окна, зелёная — окно, красная — после; отметка «сейчас».
 * Окна нет (старт позже отсечки) — полоса целиком красная, без подписей.
 */
function CoffeeTimeline({ start, cutoff, now, width }: { start: number; cutoff: number; now: number; width: number }) {
  const x = (m: number) => (Math.min(1440, Math.max(0, m)) / 1440) * width;
  const barY = 14;
  const open = cutoff > start;
  return (
    <View pointerEvents="none">
      <Svg width={width} height={44}>
        {open ? (
          <>
            <Rect x={0} y={barY} width={x(start)} height={10} rx={5} fill={ZONE_RED} />
            <Rect x={x(start)} y={barY} width={x(cutoff) - x(start)} height={10} fill={ZONE_GREEN} />
            <Rect x={x(cutoff)} y={barY} width={width - x(cutoff)} height={10} rx={5} fill={ZONE_RED} />
          </>
        ) : (
          <Rect x={0} y={barY} width={width} height={10} rx={5} fill={ZONE_RED} />
        )}
        <Line x1={x(now)} x2={x(now)} y1={barY - 6} y2={barY + 16} stroke={colors.text} strokeWidth={2} strokeLinecap="round" />
        {/* Подписи — под границами окна. */}
        {open ? (
          <>
            <SvgText x={Math.max(18, x(start))} y={42} fill={colors.textFaint} fontSize={11} textAnchor="middle">
              {coffeeClock(start)}
            </SvgText>
            <SvgText x={Math.min(width - 18, x(cutoff))} y={42} fill={colors.textFaint} fontSize={11} textAnchor="middle">
              {coffeeClock(cutoff)}
            </SvgText>
          </>
        ) : null}
      </Svg>
    </View>
  );
}

/** «Кофейное окно»: статус, таймлайн (при любой оценке сна) и под ним совет по числу чашек. */
function CoffeeBody({ coffee, nowMinute, width }: { coffee: CoffeeWindow; nowMinute: number; width: number }) {
  return (
    <View style={styles.bodyGap}>
      <Text style={styles.text}>{coffee.text}</Text>
      <CoffeeTimeline start={coffee.start} cutoff={coffee.cutoff} now={nowMinute} width={width} />
      {coffee.cups ? <Text style={styles.text}>{coffee.cups.text}</Text> : null}
    </View>
  );
}

/**
 * Таймлайн суток «Цикла питания»: серая полоса дня, на ней акцентом выделен отрезок
 * от точки отсчёта голодания до первого приёма пищи, метки приёмов и отметка «сейчас».
 * Точка отсчёта бывает вчерашней (отрицательные минуты) — тогда ось начинается с неё.
 */
function FoodTimeline({ food, width }: { food: FoodCycle; width: number }) {
  const from = Math.min(0, food.fastingStart);
  const span = 1440 - from;
  const x = (m: number) => ((Math.min(1440, Math.max(from, m)) - from) / span) * width;
  const barY = 14;
  const fastingTo = Math.max(food.fastingStart, Math.min(food.firstMeal, 1440));
  return (
    <View pointerEvents="none">
      <Svg width={width} height={46}>
        <Rect x={0} y={barY} width={width} height={10} rx={5} fill={colors.track} />
        {/* Голодание: от точки отсчёта до первого приёма. */}
        <Rect x={x(food.fastingStart)} y={barY} width={Math.max(2, x(fastingTo) - x(food.fastingStart))} height={10} rx={5} fill={ZONE_GREEN} />
        {food.meals.map((meal) => (
          <Circle key={meal.title} cx={x(meal.minute)} cy={barY + 5} r={4.5} fill={colors.accent} />
        ))}
        <Line x1={x(food.nowMinute)} x2={x(food.nowMinute)} y1={barY - 6} y2={barY + 16} stroke={colors.text} strokeWidth={2} strokeLinecap="round" />
        <SvgText x={Math.max(18, x(food.fastingStart))} y={44} fill={colors.textFaint} fontSize={11} textAnchor="middle">
          {coffeeClock(food.fastingStart)}
        </SvgText>
        <SvgText x={Math.min(width - 18, x(fastingTo))} y={44} fill={colors.textFaint} fontSize={11} textAnchor="middle">
          {coffeeClock(fastingTo)}
        </SvgText>
      </Svg>
    </View>
  );
}

/** «Цикл питания»: режим дня, отрезок голодания на таймлайне, приёмы пищи и счётчик аутофагии. */
function FoodBody({ food, width }: { food: FoodCycle; width: number }) {
  return (
    <View style={styles.bodyGap}>
      <Text style={styles.mode}>{food.title}</Text>
      <Text style={styles.text}>{food.text}</Text>
      <FoodTimeline food={food} width={width} />
      <View style={styles.meals}>
        {food.meals.map((meal) => (
          <View key={meal.title} style={styles.meal}>
            <Text style={styles.mealTime}>{coffeeClock(meal.minute)}</Text>
            <Text style={styles.mealTitle}>{meal.title}</Text>
          </View>
        ))}
      </View>
      <View style={styles.autophagy}>
        <Text style={styles.autophagyText}>{food.autophagyText}</Text>
        <InfoButton title={AUTOPHAGY_INFO.title} text={AUTOPHAGY_INFO.text} />
      </View>
    </View>
  );
}

interface Slide {
  key: Exclude<AssistantSlide, 'advice'>;
  title: string;
  glyph: Glyph;
  /** Заглушка «Скоро» с одной декоративной строкой. */
  soon?: string;
}

const SLIDES: Slide[] = [
  // «Цикл питания» стоит раньше кофейного окна.
  { key: 'food', title: 'Цикл питания', glyph: 'food' },
  { key: 'coffee', title: 'Кофейное окно', glyph: 'coffee' },
  { key: 'endurance', title: 'Пик выносливости', glyph: 'bolt', soon: 'Покажет время дня, когда тренировки даются легче.' },
  { key: 'sleepmode', title: 'Режим сна', glyph: 'moon', soon: 'Поможет держать ровное время отхода ко сну.' },
];

/**
 * «AI Ассистент» на «Сегодня»: горизонтальная карусель с точками. Открытая карточка живёт
 * в состоянии компонента, поэтому «Сегодня» пересоздаёт карусель по `key` (см. index.tsx):
 * после загрузки новых данных она снова начинается с первой карточки, а не с последней открытой.
 * Первая карточка — совет
 * из ReportGenerator, дальше карточки функций. Каждый слайд сразу показывает своё содержимое:
 * отдельного нажатия «открыть» нет, единственный жест — свайп. Какие слайды есть, решает
 * `recommendationsFor`: без оценки сна за сегодня «Кофейного окна» нет вовсе.
 * «Эстафета от Лиса» живёт не здесь, а в листе по нажатию на маскота.
 */
export function AssistantCarousel({
  slides,
  advice,
  adviceLabel,
  coffee,
  food,
}: {
  slides: readonly AssistantSlide[];
  advice: string | null;
  adviceLabel: string;
  coffee: (CoffeeWindow & { nowMinute: number }) | null;
  food: FoodCycle | null;
}) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const inner = width - spacing.md * 4;
  const shown = SLIDES.filter(
    (card) => slides.includes(card.key) && (card.key !== 'coffee' || coffee) && (card.key !== 'food' || food),
  );
  const pages = 1 + shown.length;

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        <View style={[styles.page, { width }]}>
          <View style={styles.card}>
            <View style={styles.head}>
              <SparkIcon color={colors.accent} />
              <Text style={styles.title}>AI Ассистент</Text>
            </View>
            {advice ? (
              <>
                <Text style={styles.small}>{adviceLabel}</Text>
                <View style={styles.advice}>
                  <Text style={styles.adviceText}>{advice}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.text}>{ADVICE_LABEL} появится, когда день будет полным</Text>
            )}
            <View style={styles.flex} />
            {/* Слева — подпись модели, справа — подсказка про свайп. */}
            <View style={styles.footer}>
              <Text style={styles.poweredBy}>Powered by YandexGPT</Text>
              <SwipeHint />
            </View>
          </View>
        </View>
        {shown.map((card) => (
          <View key={card.key} style={[styles.page, { width }]}>
            <View style={styles.card}>
              <View style={styles.head}>
                <CardGlyph name={card.glyph} />
                <Text style={styles.title}>{card.title}</Text>
                {card.soon ? <Text style={styles.soon}>Скоро</Text> : null}
              </View>
              {card.soon ? (
                <Text style={styles.text}>{card.soon}</Text>
              ) : card.key === 'food' ? (
                food && <FoodBody food={food} width={inner} />
              ) : (
                coffee && <CoffeeBody coffee={coffee} nowMinute={coffee.nowMinute} width={inner} />
              )}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {Array.from({ length: pages }, (_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: spacing.sm },
  page: { paddingHorizontal: spacing.md },
  card: { height: ASSISTANT_HEIGHT, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: '500', flex: 1 },
  soon: {
    color: colors.textMuted,
    fontSize: 12,
    backgroundColor: colors.track,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  advice: {
    backgroundColor: 'rgba(242, 169, 59, 0.10)',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(242, 169, 59, 0.28)',
    padding: spacing.md,
  },
  adviceText: { color: colors.text, fontSize: 18, lineHeight: 27 },
  text: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  small: { color: colors.textFaint, fontSize: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  poweredBy: { color: colors.textFaint, fontSize: 11 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hintText: { color: colors.accent, fontSize: 13, fontWeight: '500' },
  flex: { flex: 1 },
  bodyGap: { gap: spacing.sm },
  mode: { color: colors.accent, fontSize: 16, fontWeight: '500' },
  meals: { flexDirection: 'row', gap: spacing.lg },
  meal: { gap: 1 },
  mealTime: { color: colors.text, fontSize: 17, fontVariant: ['tabular-nums'] },
  mealTitle: { color: colors.textFaint, fontSize: 12 },
  autophagy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  autophagyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.track },
  dotOn: { backgroundColor: colors.accent },
});
