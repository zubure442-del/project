import { useEffect, type ReactNode } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';

/**
 * Скины маскота. Сейчас один — лиса (вырезана из `reference/design/mascot_fox_reference.jpeg`).
 * Новый скин — новая запись здесь: картинка фигуры в полный рост на прозрачном фоне
 * и цвет подсветки платформы. Магазина скинов пока нет.
 */
export type MascotSkinId = 'fox';

export interface MascotSkin {
  image: ImageSourcePropType;
  /** Ширина к высоте картинки фигуры. */
  aspect: number;
  /** Где у картинки ступни: доля высоты от верха. На эту линию ставится платформа. */
  feet: number;
  /** Цвет свечения платформы и частиц. */
  glow: string;
}

export const MASCOT_SKINS: Record<MascotSkinId, MascotSkin> = {
  fox: { image: require('../../assets/mascot/fox.png'), aspect: 510 / 820, feet: 0.985, glow: colors.accent },
};

export const DEFAULT_MASCOT_SKIN: MascotSkinId = 'fox';

/** Платформа шире фигуры и ниже ступней на половину своей высоты. */
const PLATFORM_WIDTH = 1.35;
const PLATFORM_HEIGHT = 0.16;

/** Высота фигуры, при которой рамка маскота (с платформой) занимает не больше `maxWidth`. */
export const mascotHeightFor = (maxWidth: number, skin: MascotSkinId = DEFAULT_MASCOT_SKIN) =>
  maxWidth / (MASCOT_SKINS[skin].aspect * PLATFORM_WIDTH);
/** Свечение платформы «дышит»: один цикл, мс. */
const GLOW_BREATH_MS = 2600;
/** Частицы: доли ширины и высоты рамки, задержка и длительность подъёма. Фиксированы — без случайности при отрисовке. */
const PARTICLES = [
  { x: 0.1, y: 0.82, r: 1.6, delay: 0, duration: 5200 },
  { x: 0.24, y: 0.62, r: 1.2, delay: 1400, duration: 6100 },
  { x: 0.86, y: 0.78, r: 1.8, delay: 700, duration: 5600 },
  { x: 0.93, y: 0.5, r: 1.2, delay: 2600, duration: 6600 },
  { x: 0.05, y: 0.4, r: 1.1, delay: 3300, duration: 5900 },
  { x: 0.74, y: 0.3, r: 1.4, delay: 1900, duration: 7000 },
  { x: 0.34, y: 0.92, r: 1.3, delay: 4100, duration: 5000 },
  { x: 0.66, y: 0.95, r: 1.5, delay: 3000, duration: 5400 },
] as const;
/** Насколько поднимается частица за цикл, доля высоты рамки. */
const PARTICLE_RISE = 0.28;
const PARTICLE_OPACITY = 0.7;

function Particle({ x, y, r, delay, duration, box, color, still }: (typeof PARTICLES)[number] & {
  box: { width: number; height: number };
  color: string;
  still: boolean;
}) {
  const t = useSharedValue(still ? 0.5 : 0);
  useEffect(() => {
    if (still) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
  }, [delay, duration, still, t]);
  const rise = box.height * PARTICLE_RISE;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 0.75, 1], [0, PARTICLE_OPACITY, PARTICLE_OPACITY * 0.6, 0]),
    transform: [{ translateY: -rise * t.value }],
  }));
  return (
    <Animated.View
      style={[
        styles.particle,
        { left: x * box.width - r, top: y * box.height - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * Маскот «Сегодня»: фигура в полный рост лицом к пользователю, как коллекционная фигурка,
 * на светящейся платформе, с лёгкими частицами вокруг. Число дня рисуется рядом, не поверх.
 * `skin` — какой скин надет; `overlay` — слой поверх фигуры в той же рамке (под предметы скинов).
 * При системном «Уменьшении движения» свечение и частицы стоят на месте.
 */
export function Mascot({
  height,
  skin = DEFAULT_MASCOT_SKIN,
  overlay,
}: {
  /** Высота фигуры, pt. */
  height: number;
  skin?: MascotSkinId;
  overlay?: ReactNode;
}) {
  const look = MASCOT_SKINS[skin];
  const still = useReducedMotion();
  const figure = { width: height * look.aspect, height };
  const platform = { width: figure.width * PLATFORM_WIDTH, height: height * PLATFORM_HEIGHT };
  const box = { width: platform.width, height: height * look.feet + platform.height / 2 };

  const breath = useSharedValue(1);
  useEffect(() => {
    if (still) {
      cancelAnimation(breath);
      breath.value = 1;
      return;
    }
    breath.value = withRepeat(withTiming(0.7, { duration: GLOW_BREATH_MS, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [breath, still]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <View style={[styles.root, box]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Мягкое свечение за фигурой. */}
      <Svg style={StyleSheet.absoluteFill} width={box.width} height={box.height}>
        <Defs>
          <RadialGradient id="mascotBack" cx="50%" cy="55%" rx="50%" ry="45%">
            <Stop offset="0" stopColor={look.glow} stopOpacity={0.14} />
            <Stop offset="1" stopColor={look.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={box.width / 2} cy={box.height * 0.55} rx={box.width / 2} ry={box.height * 0.45} fill="url(#mascotBack)" />
      </Svg>

      {/* Платформа-подсветка под ногами. */}
      <Animated.View style={[styles.platform, { width: platform.width, height: platform.height }, glowStyle]}>
        <Svg width={platform.width} height={platform.height}>
          <Defs>
            <RadialGradient id="mascotPlatform" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={look.glow} stopOpacity={0.75} />
              <Stop offset="0.45" stopColor={look.glow} stopOpacity={0.28} />
              <Stop offset="1" stopColor={look.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={platform.width / 2} cy={platform.height / 2} rx={platform.width / 2} ry={platform.height / 2} fill="url(#mascotPlatform)" />
          <Ellipse
            cx={platform.width / 2}
            cy={platform.height / 2}
            rx={platform.width * 0.36}
            ry={platform.height * 0.3}
            stroke={look.glow}
            strokeOpacity={0.55}
            strokeWidth={1.2}
            fill="none"
          />
          <Ellipse
            cx={platform.width / 2}
            cy={platform.height / 2}
            rx={platform.width * 0.46}
            ry={platform.height * 0.4}
            stroke={look.glow}
            strokeOpacity={0.25}
            strokeWidth={1}
            fill="none"
          />
        </Svg>
      </Animated.View>

      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} box={box} color={look.glow} still={still} />
      ))}

      <View style={[styles.figure, figure]}>
        <Image source={look.image} style={styles.image} resizeMode="contain" />
        {overlay ? <View style={StyleSheet.absoluteFill}>{overlay}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  platform: { position: 'absolute', bottom: 0 },
  figure: { position: 'absolute', top: 0 },
  image: { width: '100%', height: '100%' },
  particle: { position: 'absolute' },
});
