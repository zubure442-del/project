import { describe, expect, it } from 'vitest';
import { CAROUSEL_GAP, CAROUSEL_PEEK, carouselLayout, carouselMaxOffset, carouselPage } from './carouselLayout';
import { spacing } from './theme';

/** Ширины экранов: iPhone SE, 15, 15 Pro Max. */
const WIDTHS = [375, 393, 430];

describe('карусель «AI Ассистент»: край соседней карточки', () => {
  it('на первой карточке справа виден край следующей', () => {
    for (const width of WIDTHS) {
      const { card } = carouselLayout(width, 5);
      const nextLeft = spacing.md + card + CAROUSEL_GAP;
      expect(width - nextLeft).toBe(CAROUSEL_PEEK);
    }
  });

  it('последняя карточка встаёт к правому краю, слева — край предыдущей', () => {
    for (const width of WIDTHS) {
      for (const pages of [2, 3, 5]) {
        const { card, step } = carouselLayout(width, pages);
        const max = carouselMaxOffset(width, pages);
        const lastLeft = spacing.md + (pages - 1) * step - max;
        expect(lastLeft + card).toBe(width - spacing.md);
        // Слева видно столько же предыдущей, сколько справа было видно следующей.
        expect(lastLeft - CAROUSEL_GAP).toBe(CAROUSEL_PEEK);
        expect(carouselPage(max, step, pages)).toBe(pages - 1);
        // Промежуточные карточки встают ровно на шаг.
        for (let k = 0; k < pages - 1; k++) {
          expect(k * step).toBeLessThanOrEqual(max);
          expect(carouselPage(k * step, step, pages)).toBe(k);
        }
      }
    }
  });

  it('одна карточка — во всю ширину, листать нечего', () => {
    expect(carouselLayout(375, 1).card).toBe(375 - spacing.md * 2);
    expect(carouselMaxOffset(375, 1)).toBe(0);
    expect(carouselPage(0, carouselLayout(375, 1).step, 1)).toBe(0);
  });
});
