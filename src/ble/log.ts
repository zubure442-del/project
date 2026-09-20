/** Кольцевой буфер сырых пакетов: нужен, чтобы присылать логи на разбор. */

export type PacketDirection = 'in' | 'out';

export interface LoggedPacket {
  /** Время телефона в миллисекундах. */
  at: number;
  direction: PacketDirection;
  hex: string;
}

const LIMIT = 3000;
const buffer: LoggedPacket[] = [];
const listeners = new Set<() => void>();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export function logPacket(direction: PacketDirection, bytes: Uint8Array): void {
  buffer.push({ at: Date.now(), direction, hex: toHex(bytes) });
  if (buffer.length > LIMIT) buffer.splice(0, buffer.length - LIMIT);
  listeners.forEach((l) => l());
}

export const packetLog = (): LoggedPacket[] => [...buffer];

export function clearPacketLog(): void {
  buffer.length = 0;
  listeners.forEach((l) => l());
}

export function subscribePacketLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const stamp = (at: number) => {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/** Текст для отправки на разбор: время, направление и байты. */
export function formatPacketLog(items: LoggedPacket[] = packetLog()): string {
  return items.map((p) => `${stamp(p.at)} ${p.direction === 'in' ? '<-' : '->'} ${p.hex}`).join('\n');
}
