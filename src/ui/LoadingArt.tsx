import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, withAlpha } from './theme';

/**
 * Рисунки этапов загрузки. Заменяются без правки кода: достаточно положить новые файлы
 * с теми же именами (1080×1350, тёмный фон). Если файл не открылся — рисуем вектор.
 */
const STAGE_IMAGES: ImageSourcePropType[] = [
  require('../../assets/loading/step-1.png'),
  require('../../assets/loading/step-2.png'),
  require('../../assets/loading/step-3.png'),
  require('../../assets/loading/step-4.png'),
];

const A = colors.accent;

/** Временные векторные рисунки: кольцо, луна, шаги, дуга. */
function VectorArt({ index, size }: { index: number; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle cx={100} cy={100} r={78} fill={withAlpha(A, 0.06)} />
      {index === 0 ? (
        <>
          <Ellipse cx={100} cy={100} rx={46} ry={20} stroke={A} strokeWidth={8} fill="none" />
          <Ellipse cx={100} cy={92} rx={46} ry={20} stroke={withAlpha(A, 0.5)} strokeWidth={3} fill="none" />
        </>
      ) : index === 1 ? (
        <Path d="M122 52a52 52 0 1 0 26 90 42 42 0 1 1-26-90z" fill={withAlpha(A, 0.85)} />
      ) : index === 2 ? (
        <>
          <Ellipse cx={80} cy={120} rx={14} ry={22} fill={A} />
          <Ellipse cx={120} cy={82} rx={14} ry={22} fill={withAlpha(A, 0.6)} />
        </>
      ) : (
        <Path d="M40 130a60 60 0 1 1 120 0" stroke={A} strokeWidth={10} strokeLinecap="round" fill="none" />
      )}
    </Svg>
  );
}

function StageLayer({ index, visible, fadeMs }: { index: number; visible: boolean; fadeMs: number }) {
  const [broken, setBroken] = useState(false);
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: fadeMs });
  }, [fadeMs, opacity, visible]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.center, style]} pointerEvents="none">
      {broken ? (
        <VectorArt index={index} size={220} />
      ) : (
        <Image source={STAGE_IMAGES[index]} style={styles.image} resizeMode="cover" onError={() => setBroken(true)} />
      )}
    </Animated.View>
  );
}

/**
 * Крупный рисунок этапа. Все четыре смонтированы сразу — так они декодируются заранее
 * и смена идёт мгновенным затуханием, без мигания.
 */
export function StageArt({ stage, fadeMs }: { stage: number; fadeMs: number }) {
  return (
    <View style={styles.root}>
      {STAGE_IMAGES.map((_, i) => (
        <StageLayer key={i} index={i} visible={stage === i + 1} fadeMs={fadeMs} />
      ))}
      {/* Низ рисунка растворяется в фоне. */}
      <Svg style={styles.fade} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <LinearGradient id="loadingFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#loadingFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '22%' },
});
