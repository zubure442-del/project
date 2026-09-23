/**
 * Общие тексты интерфейса, которые повторяются на разных экранах.
 * Меняются здесь — и сразу везде.
 */

/** Подпись к числу 0–100 рядом с маскотом. Раньше было «Итог дня». */
export const DAY_PROGRESS_LABEL = 'Прогресс дня';

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

/**
 * Кольцо не нашлось ни с первой попытки, ни со второй (по 10 секунд каждая, см. src/ble/connect.ts).
 * Заголовок и совет разделены: на экране ошибки заголовок стоит отдельной строкой.
 */
export const RING_NOT_FOUND_TITLE = 'Кольцо не найдено';
export const RING_NOT_FOUND_ADVICE =
  'Возможно, села зарядка или произошла ошибка Bluetooth-соединения. ' +
  'Попробуйте забыть устройство в настройках Bluetooth и подключиться заново.';
/** Тем же текстом отвечает BLE-слой: по нему экран загрузки узнаёт беду «кольцо не найдено». */
export const RING_NOT_FOUND_MESSAGE = `${RING_NOT_FOUND_TITLE}. ${RING_NOT_FOUND_ADVICE}`;
