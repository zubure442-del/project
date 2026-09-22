import Svg, { ClipPath, Defs, G, Path, Rect, Circle } from 'react-native-svg';
import { colors, withAlpha } from './theme';

/**
 * Кусок пиццы — наглядная мера сожжённого за неделю. `fill` (0–1) закрашивает кусок слева
 * направо: последний кусок обычно неполный. Цвет один, акцентный, как у остальных данных.
 */
export function PizzaSlice({ size = 30, fill = 1 }: { size?: number; fill?: number }) {
  const share = Math.max(0, Math.min(1, fill));
  const whole = share >= 1;
  const id = `pizza${Math.round(share * 100)}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {whole ? null : (
        <>
          <Defs>
            <ClipPath id={id}>
              <Rect x={0} y={0} width={24 * share} height={24} />
            </ClipPath>
          </Defs>
          {/* Незакрашенная часть куска — еле видимый контур. */}
          <Path
            d="M12 21.5 3.6 6.2a1 1 0 0 1 .4-1.4 18 18 0 0 1 16 0 1 1 0 0 1 .4 1.4z"
            fill={withAlpha(colors.accent, 0.08)}
            stroke={withAlpha(colors.accent, 0.35)}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        </>
      )}
      <G clipPath={whole ? undefined : `url(#${id})`}>
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
      </G>
    </Svg>
  );
}
