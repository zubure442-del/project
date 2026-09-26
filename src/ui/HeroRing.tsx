import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
/** Заполнение дуги и счёт числа вверх. */
export const HERO_FILL_MS = 800;
/** Запас после анимации, потом дуга рисуется обычными свойствами. */
const HERO_SETTLE_MS = 100;

/**
 * Крупное кольцо-герой: градиентная дуга со свечением на конце и число внутри.
 * При смене значения дуга доезжает от прошлого к новому, число считает вверх.
 *
 * Анимация — только украшение. Если данные пришли, пока вкладка была скрыта, кадры анимации
 * до дуги иногда не доходили, и кольцо оставалось пустым с числом внутри (скриншот владельца 26.09).
 * Поэтому анимированная дуга видна только на время анимации, а потом её сменяет обычная дуга,
 * нарисованная React по конечному значению: она не зависит от того, дошли ли кадры.
 */
export function HeroRing({
  value,
  size = 190,
  caption,
  hapticOnChange = true,
}: {
  /** null — оценка не считается: кольцо пунктиром и «Данные собираются» вместо числа. */
  value: number | null;
  size?: number;
  caption?: string;
  hapticOnChange?: boolean;
}) {
  const collecting = value === null;
  const thickness = Math.max(8, size * 0.055);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const target = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;

  const filled = useSharedValue(0);
  const [shown, setShown] = useState(value ?? 0);
  const previous = useRef<number | null>(null);
  /** Значение, до которого анимация уже должна была доехать; пока оно не равно цели — анимируем. */
  const [settled, setSettled] = useState<number | null>(null);
  const animating = settled !== target;

  useEffect(() => {
    filled.value = withTiming(target, { duration: HERO_FILL_MS, easing: Easing.out(Easing.cubic) });
    const done = setTimeout(() => setSettled(target), HERO_FILL_MS + HERO_SETTLE_MS);
    return () => clearTimeout(done);
  }, [filled, target]);

  // Число считаем вверх в JS: цифра меняется десяток раз, на плавность это не влияет.
  useEffect(() => {
    if (value === null) {
      previous.current = null;
      const reset = setTimeout(() => setShown(0), 0);
      return () => clearTimeout(reset);
    }
    if (hapticOnChange && previous.current !== null && previous.current !== value) void Haptics.selectionAsync();
    const from = previous.current ?? 0;
    previous.current = value;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - startedAt) / HERO_FILL_MS);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(from + (value - from) * eased));
      if (k >= 1) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [hapticOnChange, value]);

  const arcProps = useAnimatedProps(() => ({
    strokeDasharray: `${circumference * filled.value} ${circumference}`,
  }));
  const tipProps = useAnimatedProps(() => {
    const angle = (-90 + 360 * filled.value) * (Math.PI / 180);
    return { cx: cx + r * Math.cos(angle), cy: cx + r * Math.sin(angle), opacity: filled.value > 0 ? 1 : 0 };
  });
  const tipAngle = (-90 + 360 * target) * (Math.PI / 180);
  const tip = { x: cx + r * Math.cos(tipAngle), y: cx + r * Math.sin(tipAngle) };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="hero-arc" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor={colors.arcFrom} />
            <Stop offset="1" stopColor={colors.arcTo} />
          </LinearGradient>
          <RadialGradient id="hero-glow">
            <Stop offset="0" stopColor={colors.arcTo} stopOpacity={0.55} />
            <Stop offset="0.45" stopColor={colors.arcTo} stopOpacity={0.16} />
            <Stop offset="1" stopColor={colors.arcTo} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={cx}
          cy={cx}
          r={r}
          stroke={colors.track}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={collecting ? '6 8' : undefined}
          strokeLinecap={collecting ? 'round' : undefined}
        />
        {/* Во время анимации — анимированная дуга. */}
        <G opacity={animating ? 1 : 0}>
          <AnimatedCircle
            cx={cx}
            cy={cx}
            r={r}
            stroke="url(#hero-arc)"
            strokeWidth={thickness}
            strokeLinecap="round"
            fill="none"
            transform={`rotate(-90 ${cx} ${cx})`}
            animatedProps={arcProps}
          />
          <AnimatedCircle r={thickness * 2.4} fill="url(#hero-glow)" animatedProps={tipProps} />
        </G>
        {/* После — та же дуга по конечному значению; при нуле дуги нет (иначе круглый край рисует точку). */}
        {!animating && target > 0 ? (
          <G>
            <Circle
              cx={cx}
              cy={cx}
              r={r}
              stroke="url(#hero-arc)"
              strokeWidth={thickness}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference * target} ${circumference}`}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
            <Circle cx={tip.x} cy={tip.y} r={thickness * 2.4} fill="url(#hero-glow)" />
          </G>
        ) : null}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {collecting ? (
          <Text style={styles.collecting}>Данные собираются</Text>
        ) : (
          <Text style={[styles.value, { fontSize: size * 0.34 }]}>{shown}</Text>
        )}
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  value: { color: colors.text, fontWeight: '200', letterSpacing: -1 },
  collecting: { color: colors.textMuted, fontSize: 13 },
  caption: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
});
