import Svg, { Path } from 'react-native-svg';
import { colors } from './theme';

/** Орех (жёлудь): валюта «Эстафеты». Линии 24×24 в акцентном цвете, как остальные значки. */
export function NutGlyph({ size = 16, color = colors.accent }: { size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...p} fill={color} fillOpacity={0.25} d="M4.5 10.5C4.5 7 7.8 4.8 12 4.8s7.5 2.2 7.5 5.7z" />
      <Path {...p} fill="none" d="M12 4.8V2.6M6.3 10.5c0 5 2.6 8.6 5.7 10.4 3.1-1.8 5.7-5.4 5.7-10.4" />
    </Svg>
  );
}

/** Огонёк серии. */
export function FlameGlyph({ size = 18, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2.5c.7 3.2 4.8 5.3 4.8 10.3a4.8 4.8 0 0 1-9.6 0c0-2.2 1-3.7 2.2-4.9.1 1.7.8 2.8 2 3.3-.6-3 .1-6 .6-8.7z"
        fill={color}
      />
    </Svg>
  );
}

/** Флажок эстафеты — значок заголовка карточки. */
export function RelayGlyph({ size = 22, color = colors.accent }: { size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...p} d="M6 21V3.5M6 4h11l-2.5 4 2.5 4H6" />
    </Svg>
  );
}

/** Галочка полученной ступени. */
export function CheckGlyph({ size = 12, color = colors.bg }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
