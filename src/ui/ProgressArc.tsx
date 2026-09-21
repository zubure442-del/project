import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Logo } from './Logo';
import { colors } from './theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressArcProps {
  size: number;
  /** 0..1. Считается по реальной доле выполненных запросов. */
  progress: number;
  /** Счётчик пакетов: каждое изменение запускает блик по дуге. */
  pulse?: number;
  /** Логотип внутри дуги «дышит», пока идёт загрузка. */
  breathing?: boolean;
  /** Системное «Уменьшение движения»: без дыхания и бликов. */
  reduceMotion?: boolean;
  showLogo?: boolean;
}

/**
 * Дуга загрузки на экране загрузки (в карточке этапа, с логотипом V внутри). Размер — параметром.
 * Значения живут в shared values, поэтому анимация идёт на UI-потоке и не спотыкается
 * о разбор пакетов и расчёты в JS.
 */
export function ProgressArc({
  size,
  progress,
  pulse = 0,
  breathing = false,
  reduceMotion = false,
  showLogo = false,
}: ProgressArcProps) {
  const thickness = Math.max(2, size * 0.035);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  const filled = useSharedValue(0);
  const glow = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    filled.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [filled, progress]);

  useEffect(() => {
    if (!pulse || reduceMotion) return;
    glow.value = 0;
    glow.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
  }, [glow, pulse, reduceMotion]);

  useEffect(() => {
    if (breathing && !reduceMotion) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: 1250, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.0, { duration: 1250, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [breathing, reduceMotion, scale]);

  const arcProps = useAnimatedProps(() => ({
    strokeDasharray: `${circumference * filled.value} ${circumference}`,
  }));

  const glowProps = useAnimatedProps(() => {
    const head = filled.value * circumference;
    const tail = Math.max(0, head - circumference * 0.12);
    return {
      strokeDasharray: `${head - tail} ${circumference}`,
      strokeDashoffset: -tail,
      opacity: glow.value === 0 ? 0 : 1 - glow.value,
    };
  });

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={thickness} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={arcProps}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.arcTo}
          strokeWidth={thickness * 1.4}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={glowProps}
        />
      </Svg>
      {showLogo ? (
        <View style={styles.center} pointerEvents="none">
          <Animated.View style={logoStyle}>
            <Logo size={size * 0.42} />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
