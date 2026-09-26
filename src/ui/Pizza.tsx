import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
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

/** Кусков в одной пицце. */
export const PIZZA_SLICES_PER_PIE = 8;
/** Больше целых пицц в стопке не рисуем: дальше «+N», точное число кусков — в подписи. */
export const PIZZA_MAX_PIES = 4;
/** Насколько следующая пицца заходит на предыдущую: стопка, а не ряд. */
const PIE_STEP = 0.62;

/** Точка на окружности радиуса r вокруг центра (c, c); угол в градусах от оси X по часовой. */
const at = (c: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { cx: c + r * Math.cos(a), cy: c + r * Math.sin(a) };
};
const point = (c: number, r: number, deg: number) => {
  const p = at(c, r, deg);
  return `${p.cx} ${p.cy}`;
};

/**
 * Одна круглая пицца из восьми кусков: `filled` из них «сожжены» — с корочкой и начинкой,
 * остальные — пустые тёмные. Рисуется внутри общего Svg со сдвигом `x`.
 * Подложка цвета карточки отделяет пиццу от той, что лежит под ней.
 */
function Pie({ size, filled, x }: { size: number; filled: number; x: number }) {
  const c = size / 2;
  const r = c - 2;
  const sector = 360 / PIZZA_SLICES_PER_PIE;
  const slices = Array.from({ length: PIZZA_SLICES_PER_PIE }, (_, i) => {
    const from = -90 + i * sector;
    return { from, to: from + sector, mid: from + sector / 2, on: i < filled };
  });
  return (
    <G transform={`translate(${x}, 0)`}>
      <Circle cx={c} cy={c} r={c} fill={colors.card} />
      {slices.map((s, i) => (
        <Path
          key={`s${i}`}
          d={`M${c} ${c} L${point(c, r, s.from)} A${r} ${r} 0 0 1 ${point(c, r, s.to)} Z`}
          fill={s.on ? withAlpha(colors.accent, 0.42) : colors.track}
        />
      ))}
      {slices.map((s, i) =>
        s.on ? (
          <G key={`t${i}`}>
            {/* Корочка по краю и начинка: два кружка на кусок. */}
            <Path
              d={`M${point(c, r - 1.3, s.from)} A${r - 1.3} ${r - 1.3} 0 0 1 ${point(c, r - 1.3, s.to)}`}
              stroke={colors.accent}
              strokeWidth={2.6}
              fill="none"
            />
            <Circle {...at(c, 0.6 * r, s.mid)} r={r * 0.1} fill={colors.accent} />
            <Circle {...at(c, 0.32 * r, s.mid + 10)} r={r * 0.065} fill={colors.accent} />
          </G>
        ) : null,
      )}
      {/* Разрезы между кусками — цветом карточки. */}
      {slices.map((s, i) => {
        const edge = at(c, r, s.from);
        return <Line key={`l${i}`} x1={c} y1={c} x2={edge.cx} y2={edge.cy} stroke={colors.card} strokeWidth={1.4} />;
      })}
    </G>
  );
}

/**
 * Куски, сложенные в целые пиццы: полные пиццы стопкой, сверху — начатая. Так 9 кусков
 * читаются с одного взгляда — «пицца и ещё кусок». Ноль кусков — одна пустая пицца.
 */
export function PizzaStack({ slices, size = 52 }: { slices: number; size?: number }) {
  const whole = Math.max(0, Math.floor(slices));
  const pies = Math.max(1, Math.ceil(whole / PIZZA_SLICES_PER_PIE));
  const shown = Math.min(PIZZA_MAX_PIES, pies);
  const hidden = pies - shown;
  const step = size * PIE_STEP;
  const width = size + (shown - 1) * step;
  // Лишние пиццы спрятаны — тогда все нарисованные полные; иначе последняя (верхняя) — начатая.
  const filledOf = (i: number) =>
    hidden > 0 || i < shown - 1 ? PIZZA_SLICES_PER_PIE : whole - PIZZA_SLICES_PER_PIE * (shown - 1);
  return (
    <View style={styles.stack} pointerEvents="none">
      <Svg width={width} height={size}>
        {Array.from({ length: shown }, (_, i) => (
          <Pie key={i} size={size} filled={filledOf(i)} x={i * step} />
        ))}
      </Svg>
      {hidden > 0 ? <Text style={styles.more}>+{hidden}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  more: { color: colors.textMuted, fontSize: 13 },
});
