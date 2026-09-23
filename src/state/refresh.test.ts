import { describe, expect, it } from 'vitest';
import type { Phase } from './provider';
import { refreshIndicatorVisible } from './refresh';

/**
 * Все фазы разом: Record<Phase, …> не даст забыть новую — тип не сойдётся.
 * Спиннер виден только во время самой загрузки.
 */
const EXPECTED: Record<Phase, boolean> = {
  idle: false,
  loading: true,
  done: false,
  failed: false,
  fresh: false,
};

/** Пути, которыми загрузка заканчивается на самом деле (см. sync в provider.tsx). */
const PATHS: Record<string, Phase[]> = {
  'удачная выгрузка': ['idle', 'loading', 'done', 'idle'],
  'свежий кэш — к кольцу не идём': ['idle', 'fresh', 'idle'],
  'кольцо не нашлось (таймаут 10 + 10 с)': ['idle', 'loading', 'failed', 'idle'],
  'связь оборвалась на середине': ['idle', 'loading', 'done', 'idle'],
  'обрыв без единого дня в кэше': ['idle', 'loading', 'failed', 'idle'],
};

describe('СИНТЕТИЧЕСКИЕ: индикатор обновления гаснет на всех путях завершения', () => {
  it('виден только во время загрузки', () => {
    for (const [phase, visible] of Object.entries(EXPECTED) as [Phase, boolean][]) {
      expect(refreshIndicatorVisible(phase)).toBe(visible);
    }
  });

  for (const [name, path] of Object.entries(PATHS)) {
    it(`${name}: в конце спиннера нет`, () => {
      const seen = path.map(refreshIndicatorVisible);
      expect(seen[seen.length - 1]).toBe(false);
      // И на каждом шаге после загрузки он уже погашен, не дожидаясь прокрутки экрана.
      path.forEach((phase, i) => {
        if (phase !== 'loading') expect(seen[i]).toBe(false);
      });
    });
  }

  it('после загрузки индикатор гаснет раньше, чем закроется экран загрузки', () => {
    // Экран загрузки висит и в фазе done/failed — спиннер под ним уже снят.
    expect(refreshIndicatorVisible('done')).toBe(false);
    expect(refreshIndicatorVisible('failed')).toBe(false);
  });
});
