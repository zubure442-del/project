import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { FLASK_LAYER, FLASK_STAGE_TEXT, type FlaskStage } from '../domain';
import { useReduceMotion } from './motion';
import { colors, withAlpha } from './theme';

/** Размер колбы: небольшая, чтобы блок читался как один рисунок под заголовком. */
export const FLASK_WIDTH = 44;
export const FLASK_HEIGHT = 108;
/** Высота волны на поверхности воды. */
const WAVE_HEIGHT = 8;
/** Полный проход волны и лёгкое покачивание уровня. */
const WAVE_MS = 3400;
const BOB_MS = 2200;
const BOB_PX = 1.5;
/** Уровень воды подтягивается к новому значению плавно. */
const LEVEL_MS = 900;

const WATER = withAlpha(colors.accent, 0.55);
const WATER_EDGE = withAlpha(colors.accent, 0.75);
const GLASS_LINE = withAlpha(colors.accent, 0.35);

/** Слои сверху вниз — в том же порядке, в каком стоят подписи справа. */
const STAGES: FlaskStage[] = ['autophagy', 'fat', 'processing'];

/** Синусоида в две волны шириной 2×W: при сдвиге на W картинка повторяется без стыка. */
function wavePath(w: number, h: number): string {
  const half = w / 2;
  return `M0 ${h / 2} q ${half / 2} -${h / 2} ${half} 0 t ${half} 0 t ${half} 0 t ${half} 0 V ${h + 2} H 0 Z`;
}

/** Стекло с водой: уровень 0–100 % высоты и насечки между слоями. */
function Glass({ fill }: { fill: number }) {
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
    <View style={styles.glass}>
      <Animated.View style={[styles.water, waterStyle]}>
        <Animated.View style={[styles.wave, waveStyle]}>
          <Svg width={FLASK_WIDTH * 2} height={WAVE_HEIGHT + 2}>
            <Path d={wavePath(FLASK_WIDTH, WAVE_HEIGHT)} fill={WATER_EDGE} />
          </Svg>
        </Animated.View>
      </Animated.View>
      {/* Границы слоёв — тонкие насечки на стекле. */}
      <View style={[styles.tick, { bottom: (FLASK_HEIGHT * FLASK_LAYER) / 100 }]} />
      <View style={[styles.tick, { bottom: (FLASK_HEIGHT * FLASK_LAYER * 2) / 100 }]} />
    </View>
  );
}

/**
 * Колба «Текущего метаболизма»: слева стекло с водой, справа три подписи слоёв.
 * От каждого слоя к своей подписи идёт выноска — видно, какой уровень что означает.
 * Текущий слой подсвечен акцентом. Вода аккуратно покачивается; при системном
 * «Уменьшении движения» стоит ровно.
 */
export function Flask({ fill, stage }: { fill: number; stage: FlaskStage }) {
  return (
    <View style={styles.root} pointerEvents="none">
      <Glass fill={fill} />
      <View style={styles.rows}>
        {STAGES.map((name) => {
          const on = stage === name;
          return (
            <View key={name} style={styles.row}>
              <View style={[styles.leader, on && styles.leaderOn]} />
              <View style={[styles.dot, on && styles.dotOn]} />
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
                {FLASK_STAGE_TEXT[name]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
  glass: {
    width: FLASK_WIDTH,
    height: FLASK_HEIGHT,
    borderRadius: FLASK_WIDTH / 2,
    borderWidth: 1.5,
    borderColor: GLASS_LINE,
    backgroundColor: withAlpha(colors.accent, 0.07),
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  water: { backgroundColor: WATER },
  wave: { position: 'absolute', left: 0, top: -WAVE_HEIGHT },
  tick: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: withAlpha(colors.accent, 0.22) },

  rows: { height: FLASK_HEIGHT, flex: 1 },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  leader: { flex: 1, height: 1, backgroundColor: withAlpha(colors.accent, 0.18) },
  leaderOn: { backgroundColor: withAlpha(colors.accent, 0.5) },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: withAlpha(colors.accent, 0.3), marginRight: 6 },
  dotOn: { backgroundColor: colors.accent },
  label: { color: colors.textFaint, fontSize: 13, width: 108, textAlign: 'right' },
  labelOn: { color: colors.accent, fontWeight: '600' },
});
