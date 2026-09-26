import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useIsFocused } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { colors } from './theme';

/**
 * Скины маскота. Сейчас один — лиса: видео дизайнера по кругу (владелец 26.09: «вместо статичной
 * фотки — чтобы он красиво зацикленно стоял; ничего не добавляй — ни частиц, ни платформ»).
 * Скрипт `reference/design/make-mascot-video.py` только заменяет серый фон ролика фоном приложения
 * и обрезает кадр. Новый скин — новая запись здесь и новый ролик. Магазина скинов пока нет.
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
}

export const MASCOT_SKINS: Record<MascotSkinId, MascotSkin> = {
  fox: {
    video: require('../../assets/mascot/fox-idle.mp4'),
    poster: require('../../assets/mascot/fox-idle.png'),
    frame: { width: 540, height: 768 },
    figure: 684,
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
 * Маскот «Сегодня»: видео лисы по кругу — дышит, моргает, помахивает хвостом. Число дня рисуется
 * рядом, не поверх. `skin` — какой скин надет; `overlay` — слой поверх фигуры (под будущие предметы).
 * Без звука, музыку в других приложениях не трогает, экран включённым не держит; пауза, когда вкладка
 * не видна или приложение свёрнуто. При системном «Уменьшении движения» — первый кадр.
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
  const [shown, setShown] = useState(false);
  const scale = height / look.figure;
  const box = { width: look.frame.width * scale, height: look.frame.height * scale };
  const playing = focused && !still;

  const player = useVideoPlayer(look.video, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.keepScreenOnWhilePlaying = false;
    p.showNowPlayingNotification = false;
    p.staysActiveInBackground = false;
  });

  // Играет, пока вкладка видна. Запускаем и когда видео готово, и при возврате приложения на экран:
  // iOS ставит плеер на паузу в фоне, а приложение могло и запуститься в фоне (фоновое обновление).
  useEffect(() => {
    if (!playing) {
      player.pause();
      return;
    }
    player.play();
    const ready = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') player.play();
    });
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') player.play();
    });
    return () => {
      ready.remove();
      app.remove();
    };
  }, [player, playing]);

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
      {overlay ? <View style={StyleSheet.absoluteFill}>{overlay}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  hidden: { opacity: 0 },
});
