import { Image } from 'react-native';
import { colors } from './theme';

const MARK = require('../../assets/images/logo-mark.png');
const LOCKUP = require('../../assets/images/logo-lockup.png');
/** Пропорции исходного логотипа (reference/logo.jpg). */
const LOCKUP_RATIO = 1500 / 658;

/** Знак Vuelo — сам файл логотипа, перекрашенный в акцентный цвет. */
export function Logo({ size = 28, color = colors.accent }: { size?: number; color?: string }) {
  return <Image source={MARK} style={{ width: size, height: size, tintColor: color }} resizeMode="contain" />;
}

/** Знак вместе с надписью «Vuelo». */
export function LogoLockup({ height = 24, color = colors.accent }: { height?: number; color?: string }) {
  return (
    <Image
      source={LOCKUP}
      style={{ width: height * LOCKUP_RATIO, height, tintColor: color }}
      resizeMode="contain"
    />
  );
}
