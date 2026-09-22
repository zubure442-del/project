import Svg, { Circle, Path } from 'react-native-svg';
import { colors, withAlpha } from './theme';

/** Кусок пиццы — наглядная мера сожжённого за неделю. Куски только целые. */
export function PizzaSlice({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 21.5 3.6 6.2a1 1 0 0 1 .4-1.4 18 18 0 0 1 16 0 1 1 0 0 1 .4 1.4z"
        fill={withAlpha(colors.accent, 0.45)}
        stroke={colors.accent}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <Path d="M4 5.3a18 18 0 0 1 16 0" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Circle cx={9} cy={9.6} r={1.5} fill={colors.accent} />
      <Circle cx={14.6} cy={10.6} r={1.3} fill={colors.accent} />
      <Circle cx={11.8} cy={15} r={1.2} fill={colors.accent} />
    </Svg>
  );
}
