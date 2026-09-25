import { describe, expect, it } from 'vitest';
import type { Phase } from './provider';
import { refreshControlKey, refreshIndicatorVisible } from './refresh';

/**
 * Все фазы разом: Record<Phase, …> не даст забыть новую — тип не сойдётся.
 * Ключ «loading» только во время самой загрузки: на любом её конце он другой,
 * то есть нативный контрол пересоздаётся и растянутым остаться не может.
 */
const EXPECTED: Record<Phase, 'loading' | 'idle'> = {
  idle: 'idle',
  loading: 'loading',
  done: 'idle',
  failed: 'idle',
  fresh: 'idle',
  background: 'loading',
};

/** Пути, которыми загрузка заканчивается на самом деле (см. sync в provider.tsx). */
const PATHS: Record<string, Phase[]> = {
  'удачная выгрузка': ['idle', 'loading', 'done', 'idle'],
  'свежий кэш — к кольцу не идём': ['idle', 'fresh', 'idle'],
  'кольцо не нашлось (таймаут 10 + 10 с)': ['idle', 'loading', 'failed', 'idle'],
  'связь оборвалась на середине': ['idle', 'loading', 'done', 'idle'],
  'обрыв без единого дня в кэше': ['idle', 'loading', 'failed', 'idle'],
  'фоновая догрузка при заполненном кэше': ['idle', 'background', 'idle'],
};

describe('СИНТЕТИЧЕСКИЕ: индикатор обновления не залипает ни на одном пути завершения', () => {
  it('спиннер поверх содержимого не показываем: прогресс живёт на экране загрузки', () => {
    expect(refreshIndicatorVisible()).toBe(false);
  });

  it('ключ контрола — «loading» только во время загрузки', () => {
    for (const [phase, key] of Object.entries(EXPECTED) as [Phase, 'loading' | 'idle'][]) {
      expect(refreshControlKey(phase)).toBe(key);
    }
  });

  for (const [name, path] of Object.entries(PATHS)) {
    it(`${name}: к концу контрол пересоздан и спиннера нет`, () => {
      const keys = path.map(refreshControlKey);
      expect(keys[keys.length - 1]).toBe('idle');
      // На каждом шаге после загрузки ключ уже сменился — не дожидаясь прокрутки экрана.
      path.forEach((phase, i) => {
        if (phase !== 'loading' && phase !== 'background') expect(keys[i]).toBe('idle');
      });
      // Загрузка была — значит ключ менялся, и нативный контрол собран заново.
      if (path.includes('loading') || path.includes('background')) expect(new Set(keys).size).toBe(2);
    });
  }
});
