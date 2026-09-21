import { describe, expect, it } from 'vitest';
import { CENTER_LABEL_GAP, CENTER_SIZE, TAB_BAR_CONTENT, tabBarLayout } from './tabBarLayout';

/** Размеры экранов в точках и нижняя системная полоса. */
const SCREENS = {
  'iPhone SE': { width: 375, inset: 0 },
  'iPhone 15 Pro Max': { width: 430, inset: 34 },
};

describe('нижняя панель: круг «Сегодня» не закрывает подпись', () => {
  for (const [name, screen] of Object.entries(SCREENS)) {
    it(name, () => {
      const l = tabBarLayout(screen.width, screen.inset);
      expect(l.circleBottom - l.circleTop).toBe(CENTER_SIZE);
      expect(l.labelTop - l.circleBottom).toBeGreaterThanOrEqual(CENTER_LABEL_GAP);
      // Подпись целиком внутри панели и не уходит под полосу «домой».
      expect(l.labelBottom).toBeLessThanOrEqual(TAB_BAR_CONTENT);
      expect(l.barHeight).toBe(TAB_BAR_CONTENT + screen.inset);
      expect(l.labelsFit).toBe(true);
    });
  }
});
