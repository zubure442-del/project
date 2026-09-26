/**
 * Кольцо хранит ЛОКАЛЬНОЕ время как unix-секунды. Поэтому метку из пакета разбираем как UTC
 * и не переводим в зону: getUTC* уже даёт «настенное» время пользователя.
 * Все метки в приложении — такие «кольцевые» секунды (ringTs).
 */
export const MIN_VALID_TS = 1_000_000_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function wallClock(ringTs: number) {
  const d = new Date(ringTs * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** «2026-09-18» — ключ дня по настенному времени. */
export function dateKey(ringTs: number): string {
  const w = wallClock(ringTs);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Дата за `offset` дней до `today` («2026-09-18»): так архивный запрос «день назад» превращается в дату. */
export const dateForOffset = (offset: number, today: string): string =>
  new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);

/** «2026-09-18 08:15:00». */
export function formatWall(ringTs: number): string {
  const w = wallClock(ringTs);
  return `${dateKey(ringTs)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

/** Текущее время телефона как кольцевая метка (epoch + смещение зоны). */
export function nowRingTs(nowMs: number, tzOffsetSeconds: number): number {
  return Math.floor(nowMs / 1000) + tzOffsetSeconds;
}
