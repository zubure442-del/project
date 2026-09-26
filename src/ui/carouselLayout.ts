import { spacing } from './theme';

/**
 * Разметка карусели «AI Ассистент» в точках. Край соседней карточки — самый понятный знак,
 * что карусель листается (так в App Store и Музыке): без подписей и стрелок.
 */
/** Сколько следующей карточки видно справа. */
export const CAROUSEL_PEEK = 22;
/** Зазор между карточками. */
export const CAROUSEL_GAP = spacing.sm;

/**
 * Ширина карточки и шаг прокрутки. Одна карточка — во всю ширину (поля экрана по краям);
 * несколько — справа виден край следующей. Слева и справа у ленты обычное поле экрана,
 * поэтому последняя карточка встаёт к правому краю, а слева виден край предыдущей.
 */
export function carouselLayout(width: number, pages: number): { card: number; step: number } {
  const card = pages > 1 ? width - spacing.md - CAROUSEL_GAP - CAROUSEL_PEEK : width - spacing.md * 2;
  return { card, step: card + CAROUSEL_GAP };
}

/** Самый большой сдвиг ленты: у последней карточки он меньше целого шага. */
export function carouselMaxOffset(width: number, pages: number): number {
  const { card } = carouselLayout(width, pages);
  const content = spacing.md * 2 + pages * card + (pages - 1) * CAROUSEL_GAP;
  return Math.max(0, content - width);
}

/** Номер открытой карточки по сдвигу ленты. */
export function carouselPage(offset: number, step: number, pages: number): number {
  return Math.max(0, Math.min(pages - 1, Math.round(offset / step)));
}
