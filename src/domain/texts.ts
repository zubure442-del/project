/**
 * Общие тексты интерфейса, которые повторяются на разных экранах.
 * Меняются здесь — и сразу везде.
 */

/** Единая оговорка о немедицинском характере приложения и кольца. */
export const NOT_MEDICAL_DEVICE = 'Не является медицинским прибором';

/** Русское согласование с числом: 1 шаг, 2 шага, 5 шагов, 11 шагов, 21 шаг. */
export function pluralRu(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  const units = abs % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (units === 1) return forms[0];
  if (units >= 2 && units <= 4) return forms[1];
  return forms[2];
}

/** Число с разрядами через неразрывный пробел: 12 500. */
export const formatCount = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
