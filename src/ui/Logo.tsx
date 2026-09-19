import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from './theme';

/** Знак Vuelo: круг с вырезанной буквой V (reference/logo.jpg), перерисован вектором. */
export function Logo({ size = 28, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="50" fill={color} />
      <Path d="M22 18 L50 88 L78 18 L64 12 L50 47 L36 12 Z" fill={colors.bg} />
    </Svg>
  );
}
