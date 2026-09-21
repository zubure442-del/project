import { describe, expect, it } from 'vitest';
import { NOT_MEDICAL, TAB_INFO } from './tab-info';

describe('«i» в шапке вкладки: описание простыми словами', () => {
  for (const [key, info] of Object.entries(TAB_INFO)) {
    it(`${key}: без чисел и формул, в конце оговорка`, () => {
      const text = info.lines.join(' ');
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/[×=÷]/);
      expect(info.lines[info.lines.length - 1]).toBe(NOT_MEDICAL);
    });
  }
});
