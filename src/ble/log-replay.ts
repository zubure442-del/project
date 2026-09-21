import { hexToBytes } from '../codec';
import type { Transport } from './transport';

/**
 * Проигрыватель сырого лога кольца для тестов (в приложение не попадает).
 * На каждую команду отдаёт ровно те пакеты, что пришли после неё в логе,
 * с теми же задержками, что были на настоящем кольце.
 */
interface Segment {
  command: string;
  replies: { delayMs: number; hex: string }[];
}

const clock = (s: string) => {
  const [h, m, sec] = s.split(':');
  return (Number(h) * 3600 + Number(m) * 60 + Number(sec)) * 1000;
};

export function readLogSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let current: (Segment & { at: number }) | null = null;
  for (const line of text.split('\n')) {
    const match = /^(\d\d:\d\d:\d\d\.\d+) (->|<-) ([0-9a-f ]+?)\s*(\||$)/.exec(line);
    if (!match) continue;
    const [, time, dir, hex] = match;
    const at = clock(time);
    if (dir === '->') {
      current = { command: hex.slice(0, 5), replies: [], at };
      segments.push(current);
    } else if (current) {
      current.replies.push({ delayMs: Math.max(1, Math.round(at - current.at)), hex: hex.padEnd(59, ' 00') });
    }
  }
  return segments.map(({ command, replies }) => ({ command, replies }));
}

/** `text` — содержимое файла лога из reference/logs. */
export function logRing(text: string) {
  const segments = readLogSegments(text);
  const used = new Set<number>();
  const listeners = new Set<(d: Uint8Array) => void>();
  const sent: string[] = [];
  const transport: Transport = {
    async send(data) {
      const command = Array.from(data.slice(0, 2), (b) => b.toString(16).padStart(2, '0')).join(' ');
      sent.push(command);
      const index = segments.findIndex((s, i) => !used.has(i) && s.command === command);
      if (index < 0) return;
      used.add(index);
      for (const r of segments[index].replies) {
        setTimeout(() => listeners.forEach((l) => l(hexToBytes(r.hex))), r.delayMs);
      }
    },
    onPacket(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { transport, sent };
}
