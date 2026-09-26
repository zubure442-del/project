import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useIsFocused } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { colors } from './theme';

/**
 * Скины маскота. Сейчас один — лиса: зацикленное видео (владелец 26.09: «вместо статичной фотки —
 * чтобы он красиво зацикленно стоял»), собранное скриптом `reference/design/make-mascot-video.py`
 * из ролика дизайнера: серый фон снят, лиса стоит на фоне приложения, свечение за фигурой
 * и «дышащая» платформа под лапами уже в кадре. Новый скин — новая запись здесь и новый ролик.
 * Магазина скинов пока нет.
 */
export type MascotSkinId = 'fox';

export interface MascotSkin {
  /** Видео по кругу, без звука. */
  video: number;
  /** Первый кадр видео: виден, пока видео грузится, и при «Уменьшении движения». */
  poster: ImageSourcePropType;
  /** Размер кадра, пиксели. */
  frame: { width: number; height: number };
  /** Высота фигуры в кадре (от ушей до лап), пиксели: по ней кадр масштабируется. */
  figure: number;
  /** Цвет частиц вокруг фигуры. */
  glow: string;
}

export const MASCOT_SKINS: Record<MascotSkinId, MascotSkin> = {
  fox: {
    video: require('../../assets/mascot/fox-idle.mp4'),
    poster: require('../../assets/mascot/fox-idle.png'),
    frame: { width: 540, height: 790 },
    figure: 684,
    glow: colors.accent,
  },
};

export const DEFAULT_MASCOT_SKIN: MascotSkinId = 'fox';

/** Высота фигуры, при которой кадр маскота занимает не больше `maxWidth`. */
export const mascotHeightFor = (maxWidth: number, skin: MascotSkinId = DEFAULT_MASCOT_SKIN) =>
  (maxWidth * MASCOT_SKINS[skin].figure) / MASCOT_SKINS[skin].frame.width;

/**
 * Края кадра растворяются в фоне экрана: цвет фона в видео и на экране может разойтись на единицу-две
 * после сжатия, а мягкий край такую разницу прячет. Доли ширины и высоты кадра — там фигуры нет.
 */
const FEATHER_X = 0.05;
const FEATHER_Y = 0.03;

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

/** Мягкие края кадра цветом фона экрана. */
function Feather({ width, height }: { width: number; height: number }) {
  const x = width * FEATHER_X;
  const y = height * FEATHER_Y;
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <LinearGradient id="mascotFeatherL" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="mascotFeatherR" x1="1" y1="0" x2="0" y2="0">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="mascotFeatherT" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="mascotFeatherB" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={x} height={height} fill="url(#mascotFeatherL)" />
      <Rect x={width - x} y={0} width={x} height={height} fill="url(#mascotFeatherR)" />
      <Rect x={0} y={0} width={width} height={y} fill="url(#mascotFeatherT)" />
      <Rect x={0} y={height - y} width={width} height={y} fill="url(#mascotFeatherB)" />
    </Svg>
  );
}

/**
 * Маскот «Сегодня»: фигура в полный рост лицом к пользователю, как коллекционная фигурка, — живая:
 * зацикленное видео, где она дышит, моргает и помахивает хвостом, на светящейся платформе,
 * с лёгкими частицами вокруг. Число дня рисуется рядом, не поверх.
 * `skin` — какой скин надет; `overlay` — слой поверх фигуры в той же рамке (под предметы скинов).
 * Видео без звука и не трогает музыку в других приложениях, не держит экран включённым, стоит на паузе,
 * когда вкладка не видна или приложение свёрнуто. При системном «Уменьшении движения» — первый кадр
 * и неподвижные частицы.
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
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [shown, setShown] = useState(false);
  const scale = height / look.figure;
  const box = { width: look.frame.width * scale, height: look.frame.height * scale };

  const player = useVideoPlayer(look.video, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.keepScreenOnWhilePlaying = false;
    p.showNowPlayingNotification = false;
    p.staysActiveInBackground = false;
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!still && focused && active) {
      player.play();
    } else {
      // При «Уменьшении движения» видео не показываем вовсе: виден первый кадр-картинка.
      player.pause();
    }
  }, [player, still, focused, active]);

  return (
    <View style={[styles.root, box]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={look.poster} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {still ? null : (
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, !shown && styles.hidden]}
          contentFit="fill"
          nativeControls={false}
          allowsPictureInPicture={false}
          allowsVideoFrameAnalysis={false}
          onFirstFrameRender={() => setShown(true)}
        />
      )}
      <Feather width={box.width} height={box.height} />

      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} box={box} color={look.glow} still={still} />
      ))}

      {overlay ? <View style={StyleSheet.absoluteFill}>{overlay}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  hidden: { opacity: 0 },
  particle: { position: 'absolute' },
});
