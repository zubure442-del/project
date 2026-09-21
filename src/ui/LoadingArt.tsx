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

/** Контейнер рисунка — 4:5; файлы 859×1280 и 1031×1280 вписываются «cover» по центру. */
export const ART_ASPECT = 4 / 5;

/**
 * Крупный рисунок этапа: ОДНА картинка в ОДНОМ контейнере с пропорциями 4:5.
 * Раньше четыре картинки лежали стопкой, и у 3-й и 4-й снизу проступал лишний кусок.
 * Смена — затуханием контейнера; все файлы подгружаются заранее, без скрытых слоёв.
 */
export function StageArt({ stage, fadeMs }: { stage: number; fadeMs: number }) {
  const [shown, setShown] = useState(stage);
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const opacity = useSharedValue(1);

  useEffect(() => {
    STAGE_IMAGES.forEach((src) => {
      const { uri } = Image.resolveAssetSource(src);
      if (uri) void Image.prefetch(uri).catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    if (stage === shown) return;
    if (fadeMs === 0) {
      const timer = setTimeout(() => setShown(stage), 0);
      return () => clearTimeout(timer);
    }
    opacity.value = withTiming(0, { duration: fadeMs });
    const timer = setTimeout(() => {
      setShown(stage);
      opacity.value = withTiming(1, { duration: fadeMs });
    }, fadeMs);
    return () => clearTimeout(timer);
  }, [fadeMs, opacity, shown, stage]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const index = shown - 1;

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.frame, style]}>
        {broken[index] ? (
          <View style={styles.center}>
            <VectorArt index={index} size={220} />
          </View>
        ) : (
          <Image
            source={STAGE_IMAGES[index]}
            style={styles.image}
            resizeMode="cover"
            onError={() => setBroken((prev) => ({ ...prev, [index]: true }))}
          />
        )}
        {/* Низ рисунка мягко растворяется в фоне — в том же контейнере, без второго слоя картинки. */}
        <Svg style={styles.fade} viewBox="0 0 1 1" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="loadingFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={1} height={1} fill="url(#loadingFade)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { height: '100%', maxWidth: '100%', aspectRatio: ART_ASPECT, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '25%' },
});
