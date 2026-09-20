import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface IconProps {
  /** Цвет приходит от панели вкладок, поэтому тип её, а не string. */
  color: ColorValue;
  size?: number;
}

export const TodayIcon = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="8.5" stroke={color as string} strokeWidth="1.8" fill="none" opacity={0.45} />
    <Path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke={color as string} strokeWidth="2.2" strokeLinecap="round" fill="none" />
  </Svg>
);

export const SleepIcon = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
      stroke={color as string}
      strokeWidth="1.8"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

export const ActivityIcon = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="3.5" y="13" width="4" height="7.5" rx="1.2" fill={color as string} opacity={0.5} />
    <Rect x="10" y="8" width="4" height="12.5" rx="1.2" fill={color as string} />
    <Rect x="16.5" y="4" width="4" height="16.5" rx="1.2" fill={color as string} opacity={0.5} />
  </Svg>
);

export const BodyIcon = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6C19 15.4 12 20 12 20Z"
      stroke={color as string}
      strokeWidth="1.8"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);
