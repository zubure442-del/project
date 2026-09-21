/** Тёмный фон, один акцентный цвет. Цветом выделяем только данные. */
export const colors = {
  bg: '#0B0B0F',
  card: '#15151C',
  accent: '#F2A93B',
  /** Концы градиента главной дуги. */
  arcFrom: '#C9721F',
  arcTo: '#FFD27A',
  track: '#23232E',
  text: '#F4F4F6',
  textMuted: '#A8A8B8',
  textFaint: '#7A7A88',
  /** Только для предупреждений: незаполненные поля, плашки об ошибках. */
  danger: '#E5705F',
} as const;

/** Исключение из правила одного акцента: холодная палитра только для волны сна. */
export const SLEEP_PALETTE = {
  from: '#4C4CD6',
  to: '#8A5CF0',
  glow: '#A78BFA',
  deep: '#6D5BE0',
} as const;

export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 36 } as const;
/** Один радиус на все карточки. */
export const radius = { card: 18, pill: 999 } as const;

export const COMPONENT_LABEL = { sleep: 'Сон', activity: 'Активность', state: 'Организм' } as const;

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
