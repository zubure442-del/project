import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { coffeeClock, type CoffeeWindow } from '../domain';
import type { DaySnapshot } from '../storage';
import { SleepWave } from './SleepWave';
import { SparkIcon } from './TabIcons';
import { colors, radius, spacing, withAlpha } from './theme';

/** Карусель в несколько раз выше прежней карточки совета. */
export const ASSISTANT_HEIGHT = 340;
const ZONE_RED = withAlpha(colors.danger, 0.6);
const ZONE_GREEN = '#5DBB8C';
const HRV_COLOR = '#8FB8FF';

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

/** Таймлайн суток: красная зона до окна, зелёная — окно, красная — после; отметка «сейчас». */
function CoffeeTimeline({ start, cutoff, now, width }: { start: number; cutoff: number; now: number; width: number }) {
  const x = (m: number) => (Math.min(1440, Math.max(0, m)) / 1440) * width;
  const barY = 14;
  return (
    <View pointerEvents="none">
      <Svg width={width} height={44}>
        <Rect x={0} y={barY} width={x(start)} height={10} rx={5} fill={ZONE_RED} />
        <Rect x={x(start)} y={barY} width={x(cutoff) - x(start)} height={10} fill={ZONE_GREEN} />
        <Rect x={x(cutoff)} y={barY} width={width - x(cutoff)} height={10} rx={5} fill={ZONE_RED} />
        <Line x1={x(now)} x2={x(now)} y1={barY - 6} y2={barY + 16} stroke={colors.text} strokeWidth={2} strokeLinecap="round" />
        {/* Подписи — под границами окна. */}
        <SvgText x={Math.max(18, x(start))} y={42} fill={colors.textFaint} fontSize={11} textAnchor="middle">
          {coffeeClock(start)}
        </SvgText>
        <SvgText x={Math.min(width - 18, x(cutoff))} y={42} fill={colors.textFaint} fontSize={11} textAnchor="middle">
          {coffeeClock(cutoff)}
        </SvgText>
      </Svg>
    </View>
  );
}

/** Разворот «Кофейного окна»: предупреждение с ночью или таймлайн, в зависимости от сна. */
function CoffeeBody({ coffee, night, nowMinute, width }: { coffee: CoffeeWindow; night: DaySnapshot | null; nowMinute: number; width: number }) {
  if (coffee.kind === 'poor-sleep' && night) {
    const heart = night.heart.map((p) => ({ m: p.m, v: p.v }));
    const hrv = night.summaryPoints.filter((p) => p.hrv !== null).map((p) => ({ m: p.m, v: p.hrv as number }));
    return (
      <View style={styles.bodyGap}>
        <Text style={styles.text}>{coffee.text}</Text>
        <SleepWave
          segments={night.sleepSegments}
          width={width}
          overlays={[
            { points: heart, color: colors.accent },
            { points: hrv, color: HRV_COLOR },
          ]}
        />
        <View style={styles.legend}>
          <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
          <Text style={styles.small}>Пульс</Text>
          <View style={[styles.swatch, { backgroundColor: HRV_COLOR }]} />
          <Text style={styles.small}>Вариабельность</Text>
        </View>
      </View>
    );
  }
  if (coffee.kind === 'window') {
    return (
      <View style={styles.bodyGap}>
        <Text style={styles.text}>{coffee.text}</Text>
        <CoffeeTimeline start={coffee.start} cutoff={coffee.cutoff} now={nowMinute} width={width} />
      </View>
    );
  }
  return <Text style={styles.text}>{coffee.text}</Text>;
}

interface Folded {
  key: string;
  title: string;
  glyph: Glyph;
  /** Заглушка «Скоро» с одной декоративной строкой. */
  soon?: string;
}

const FOLDED: Folded[] = [
  { key: 'coffee', title: 'Кофейное окно', glyph: 'coffee' },
  { key: 'food', title: 'Цикл питания', glyph: 'food', soon: 'Подскажет, когда удобнее есть в течение дня.' },
  { key: 'endurance', title: 'Пик выносливости', glyph: 'bolt', soon: 'Покажет время дня, когда тренировки даются легче.' },
  { key: 'sleepmode', title: 'Режим сна', glyph: 'moon', soon: 'Поможет держать ровное время отхода ко сну.' },
];

/**
 * «AI Ассистент» на «Сегодня»: горизонтальная карусель с точками. Первая карточка — совет
 * из ReportGenerator, дальше свёрнутые карточки, разворачиваются по нажатию.
 */
export function AssistantCarousel({
  advice,
  adviceLabel,
  coffee,
  night,
  nowMinute,
}: {
  advice: string | null;
  adviceLabel: string;
  coffee: CoffeeWindow;
  night: DaySnapshot | null;
  nowMinute: number;
}) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const inner = width - spacing.md * 4;
  const pages = 1 + FOLDED.length;

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
              <Text style={styles.text}>Совет появится, когда день будет полным</Text>
            )}
            <View style={styles.flex} />
            <Text style={styles.poweredBy}>Powered by YandexGPT</Text>
          </View>
        </View>
        {FOLDED.map((card) => {
          const expanded = !!open[card.key];
          return (
            <View key={card.key} style={[styles.page, { width }]}>
              <Pressable style={styles.card} onPress={() => setOpen((prev) => ({ ...prev, [card.key]: !expanded }))}>
                <View style={styles.head}>
                  <CardGlyph name={card.glyph} />
                  <Text style={styles.title}>{card.title}</Text>
                  {card.soon ? <Text style={styles.soon}>Скоро</Text> : null}
                  <Text style={styles.chevron}>{expanded ? '−' : '+'}</Text>
                </View>
                {expanded ? (
                  card.soon ? (
                    <Text style={styles.text}>{card.soon}</Text>
                  ) : (
                    <CoffeeBody coffee={coffee} night={night} nowMinute={nowMinute} width={inner} />
                  )
                ) : (
                  <View style={styles.folded}>
                    <CardGlyph name={card.glyph} />
                    <Text style={styles.small}>Нажмите, чтобы открыть</Text>
                  </View>
                )}
              </Pressable>
            </View>
          );
        })}
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
  chevron: { color: colors.textFaint, fontSize: 20, width: 20, textAlign: 'center' },
  folded: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
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
  poweredBy: { color: colors.textFaint, fontSize: 11, textAlign: 'right' },
  flex: { flex: 1 },
  bodyGap: { gap: spacing.sm },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 2, borderRadius: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.track },
  dotOn: { backgroundColor: colors.accent },
});
