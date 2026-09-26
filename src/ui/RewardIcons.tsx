import Svg, { Path } from 'react-native-svg';
import { colors } from './theme';

/**
 * Орех (жёлудь): валюта «Эстафеты». Плотная шляпка с черенком сверху и заострённое книзу
 * ядро — прежний контурный кружок рядом с числом читался как вторая цифра «0».
 */
export function NutGlyph({ size = 16, color = colors.accent }: { size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Черенок и шляпка — сплошные: по ним жёлудь узнаётся даже в 11 px. */}
      <Path {...p} fill="none" d="M12 4.4V2.2" />
      <Path
        {...p}
        fill={color}
        d="M5.4 8.9c0-2.6 2.9-4.5 6.6-4.5s6.6 1.9 6.6 4.5c0 .6-.5 1.1-1.1 1.1H6.5c-.6 0-1.1-.5-1.1-1.1z"
      />
      {/* Ядро: книзу сходится в носик — силуэт несимметричный, на ноль не похож. */}
      <Path
        {...p}
        fill={color}
        fillOpacity={0.3}
        d="M6.9 11.5h10.2c0 4.3-1.7 7.7-4.2 9.9a1.4 1.4 0 0 1-1.8 0c-2.5-2.2-4.2-5.6-4.2-9.9z"
      />
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

/** Будущие предметы магазина — силуэты на пустой витрине: шляпа, бабочка, мяч для площадки. */
export type ShopItem = 'hat' | 'bow' | 'ball';

export function ShopItemGlyph({ name, size = 30, color = colors.textFaint }: { name: ShopItem; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'hat' ? (
        <>
          {/* Цилиндр: высокая тулья, лента и изогнутые поля. */}
          <Path {...p} d="M8 16.5 7.4 5.8c0-.7 2-1.3 4.6-1.3s4.6.6 4.6 1.3L16 16.5" />
          <Path {...p} d="M7.8 13.2h8.4" />
          <Path {...p} d="M3.5 16.5c1.5 1.8 15.5 1.8 17 0" />
        </>
      ) : name === 'bow' ? (
        <>
          <Path {...p} d="M10.2 12 4 8v8zM13.8 12 20 8v8z" />
          <Path {...p} d="M10.2 10.4h3.6v3.2h-3.6z" />
        </>
      ) : (
        <>
          <Path {...p} d="M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z" />
          <Path {...p} d="M4.6 9.5c4.8 1.8 10 1.8 14.8 0M4.6 14.5c4.8-1.8 10-1.8 14.8 0" />
        </>
      )}
    </Svg>
  );
}
