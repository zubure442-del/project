import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { FLASK_LAYER, FLASK_STAGE_TEXT, type FlaskStage } from '../domain';
import { useReduceMotion } from './motion';
import { colors, withAlpha } from './theme';

/** Размер колбы на карточке «Цикла питания». */
export const FLASK_WIDTH = 62;
export const FLASK_HEIGHT = 156;
/** Высота волны на поверхности воды. */
const WAVE_HEIGHT = 10;
/** Полный проход волны и лёгкое покачивание уровня. */
const WAVE_MS = 3400;
const BOB_MS = 2200;
const BOB_PX = 2;
/** Уровень воды подтягивается к новому значению плавно. */
const LEVEL_MS = 900;

const WATER = withAlpha(colors.accent, 0.55);
const WATER_EDGE = withAlpha(colors.accent, 0.75);

/** Синусоида в две волны шириной 2×W: при сдвиге на W картинка повторяется без стыка. */
function wavePath(w: number, h: number): string {
  const half = w / 2;
  return `M0 ${h / 2} q ${half / 2} -${h / 2} ${half} 0 t ${half} 0 t ${half} 0 t ${half} 0 V ${h + 2} H 0 Z`;
}

/**
 * Колба с водой: три слоя снизу вверх — «Переработка», «Жиросжигание», «Аутофагия».
 * Уровень зависит от того, сколько прошло с последней еды и как держится сахар.
 * Вода аккуратно покачивается; при системном «Уменьшении движения» стоит ровно.
 */
export function Flask({ fill, stage }: { fill: number; stage: FlaskStage }) {
  const reduce = useReduceMotion();
  const level = useSharedValue(0);
  const shift = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    const target = (Math.min(100, Math.max(0, fill)) / 100) * FLASK_HEIGHT;
    level.value = reduce ? target : withTiming(target, { duration: LEVEL_MS, easing: Easing.out(Easing.cubic) });
  }, [fill, level, reduce]);

  useEffect(() => {
    if (reduce) {
      shift.value = 0;
      bob.value = 0;
      return;
    }
    shift.value = 0;
    shift.value = withRepeat(withTiming(-FLASK_WIDTH, { duration: WAVE_MS, easing: Easing.linear }), -1, false);
    bob.value = withRepeat(withTiming(1, { duration: BOB_MS, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [bob, reduce, shift]);

  const waterStyle = useAnimatedStyle(() => ({ height: level.value + bob.value * BOB_PX }));
  const waveStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.glass}>
        <Animated.View style={[styles.water, waterStyle]}>
          <Animated.View style={[styles.wave, waveStyle]}>
            <Svg width={FLASK_WIDTH * 2} height={WAVE_HEIGHT + 2}>
              <Path d={wavePath(FLASK_WIDTH, WAVE_HEIGHT)} fill={WATER_EDGE} />
            </Svg>
          </Animated.View>
        </Animated.View>
        {/* Границы слоёв: тонкие насечки на стекле. */}
        <View style={[styles.tick, { bottom: (FLASK_HEIGHT * FLASK_LAYER) / 100 }]} />
        <View style={[styles.tick, { bottom: (FLASK_HEIGHT * FLASK_LAYER * 2) / 100 }]} />
      </View>

      {/* Подписи справа, снизу вверх: текущий слой — акцентом. */}
      <View style={styles.labels}>
        {(['autophagy', 'fat', 'processing'] as FlaskStage[]).map((name) => (
          <View key={name} style={styles.labelRow}>
            <Text style={[styles.label, stage === name && styles.labelOn]}>{FLASK_STAGE_TEXT[name]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  glass: {
    width: FLASK_WIDTH,
    height: FLASK_HEIGHT,
    borderRadius: FLASK_WIDTH / 2,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.accent, 0.35),
    backgroundColor: withAlpha(colors.accent, 0.07),
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  water: { backgroundColor: WATER },
  wave: { position: 'absolute', left: 0, top: -WAVE_HEIGHT },
  tick: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: withAlpha(colors.accent, 0.22) },
  labels: { height: FLASK_HEIGHT, justifyContent: 'space-around' },
  labelRow: { justifyContent: 'center' },
  label: { color: colors.textFaint, fontSize: 13 },
  labelOn: { color: colors.accent, fontWeight: '600' },
});
