/** Тёмный фон, один акцентный цвет, крупные тонкие цифры. */
export const colors = {
  bg: '#0B0B0F',
  card: '#14141B',
  cardBorder: '#1F1F2A',
  accent: '#7FE7D0',
  /** Приглушённый акцент для второстепенных дуг и графиков. */
  accentDim: '#2F5C57',
  track: '#1E1E28',
  text: '#F4F4F6',
  textMuted: '#8A8A99',
  textFaint: '#55555F',
} as const;

export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 36 } as const;
export const radius = { card: 20, pill: 999 } as const;

/** Прозрачность акцента для составляющих: одна краска, разная насыщенность. */
export const componentAlpha = { sleep: 1, activity: 0.72, state: 0.48 } as const;

export const COMPONENT_LABEL = { sleep: 'Сон', activity: 'Активность', state: 'Организм' } as const;

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
