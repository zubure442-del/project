/** Тёмный фон, один акцентный цвет, крупные тонкие цифры. Акцент — тёплый янтарный. */
export const colors = {
  bg: '#0B0B0F',
  card: '#15151C',
  cardBorder: '#24242F',
  accent: '#F2A93B',
  /** Концы градиента главной дуги: от густого янтаря к светлому золоту. */
  arcFrom: '#C9721F',
  arcTo: '#FFD27A',
  track: '#22222D',
  text: '#F4F4F6',
  textMuted: '#A8A8B8',
  textFaint: '#7A7A88',
} as const;

export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 36 } as const;
export const radius = { card: 20, pill: 999 } as const;

export const COMPONENT_LABEL = { sleep: 'Сон', activity: 'Активность', state: 'Организм' } as const;

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
