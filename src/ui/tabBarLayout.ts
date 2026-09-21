/**
 * Разметка нижней панели в точках. Всё положение считается отсюда, чтобы круг «Сегодня»
 * гарантированно не наезжал на подпись на любом iPhone (от SE до Pro Max).
 */
/** Высота панели над системной полосой «домой». */
export const TAB_BAR_CONTENT = 56;
export const TAB_ICON_SIZE = 24;
/** Отступ иконки от верхнего края панели. */
export const TAB_ICON_TOP = 7;
/** Зазор между иконкой и подписью. */
export const TAB_LABEL_GAP = 3;
export const TAB_LABEL_SIZE = 11;
export const TAB_LABEL_LINE = 14;
/** Круг «Сегодня»: диаметр и минимальный зазор от его нижнего края до подписи. */
export const CENTER_SIZE = 56;
export const CENTER_LABEL_GAP = 8;
/** Средняя ширина буквы подписи в долях кегля — для проверки, что подпись влезает. */
const GLYPH_EM = 0.58;

export const TAB_LABELS = ['Профиль', 'Сон', 'Сегодня', 'Активность', 'Тело'] as const;

export interface TabBarLayout {
  /** Полная высота панели вместе с полосой «домой». */
  barHeight: number;
  labelTop: number;
  labelBottom: number;
  /** Верх и низ круга относительно верхнего края панели (верх отрицательный — круг приподнят). */
  circleTop: number;
  circleBottom: number;
  itemWidth: number;
  /** Самая длинная подпись помещается в ячейку без обрезки. */
  labelsFit: boolean;
}

export function tabBarLayout(screenWidth: number, bottomInset: number): TabBarLayout {
  const labelTop = TAB_ICON_TOP + TAB_ICON_SIZE + TAB_LABEL_GAP;
  const circleBottom = labelTop - CENTER_LABEL_GAP;
  const itemWidth = screenWidth / TAB_LABELS.length;
  const longest = Math.max(...TAB_LABELS.map((l) => l.length));
  return {
    barHeight: TAB_BAR_CONTENT + bottomInset,
    labelTop,
    labelBottom: labelTop + TAB_LABEL_LINE,
    circleTop: circleBottom - CENTER_SIZE,
    circleBottom,
    itemWidth,
    labelsFit: longest * TAB_LABEL_SIZE * GLYPH_EM <= itemWidth,
  };
}
