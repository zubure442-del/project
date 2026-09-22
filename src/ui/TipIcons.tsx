import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

/** Иконки строк на карточках экрана загрузки. Простые линии 24×24 в акцентном цвете. */
export type TipIcon = 'finger' | 'sensor' | 'fit' | 'pulse' | 'moon' | 'split' | 'total' | 'phone' | 'info' | 'steps' | 'heart' | 'spark';

export function TipGlyph({ name, size = 22, color = colors.accent }: { name: TipIcon; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'finger' ? (
        <>
          <Path {...p} d="M9 11V4.5a1.5 1.5 0 0 1 3 0V11" />
          <Path {...p} d="M12 10.5V9.5a1.5 1.5 0 0 1 3 0v1.5m0 0V10a1.5 1.5 0 0 1 3 0v4.5A6.5 6.5 0 0 1 11.5 21h-.3a6 6 0 0 1-4.6-2.2L4 15.5a1.5 1.5 0 0 1 2.2-2L9 16" />
        </>
      ) : name === 'sensor' ? (
        <>
          <Circle {...p} cx={12} cy={12} r={2.5} />
          <Path {...p} d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
        </>
      ) : name === 'fit' ? (
        <>
          <Path {...p} d="M12 4v16" />
          <Path {...p} d="M3 12h6M7 9.5 9.5 12 7 14.5M21 12h-6M17 9.5 14.5 12l2.5 2.5" />
        </>
      ) : name === 'pulse' ? (
        <Path {...p} d="M3 12h4l2-5 4 10 2-5h6" />
      ) : name === 'moon' ? (
        <Path {...p} d="M15.5 3.5a8.5 8.5 0 1 0 5 12.7A7 7 0 0 1 15.5 3.5z" />
      ) : name === 'split' ? (
        <>
          <Circle {...p} cx={6} cy={12} r={3} />
          <Circle {...p} cx={12} cy={12} r={3} />
          <Circle {...p} cx={18} cy={12} r={3} />
        </>
      ) : name === 'total' ? (
        <>
          <Path {...p} d="M4.5 16a8 8 0 1 1 15 0" />
          <Path {...p} d="M12 12l3.5-3" />
        </>
      ) : name === 'steps' ? (
        <>
          <Path {...p} d="M8 3.5c1.7 0 2.5 1.8 2.5 4s-.8 4.5-2.5 4.5S5.5 9.7 5.5 7.5 6.3 3.5 8 3.5zM6 14.5h4v2a2 2 0 0 1-4 0z" />
          <Path {...p} d="M16 7c1.7 0 2.5 1.8 2.5 4s-.8 4.5-2.5 4.5-2.5-2.3-2.5-4.5S14.3 7 16 7zM14 18h4v1.5a2 2 0 0 1-4 0z" />
        </>
      ) : name === 'heart' ? (
        <Path {...p} d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      ) : name === 'spark' ? (
        <Path {...p} d="M12 3.5c.9 3.6 1.9 4.7 5.5 5.6-3.6.9-4.6 1.9-5.5 5.6-.9-3.7-1.9-4.7-5.5-5.6 3.6-.9 4.6-2 5.5-5.6zM18.5 15c.4 1.6.9 2.1 2.5 2.5-1.6.4-2.1.9-2.5 2.5-.4-1.6-.9-2.1-2.5-2.5 1.6-.4 2.1-.9 2.5-2.5z" />
      ) : name === 'phone' ? (
        <>
          <Rect {...p} x={7} y={2.5} width={10} height={19} rx={2.5} />
          <Path {...p} d="M10.5 18.5h3" />
        </>
      ) : (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M12 11v5.5M12 7.5v.01" />
        </>
      )}
    </Svg>
  );
}
