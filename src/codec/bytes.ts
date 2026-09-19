export const PACKET_LENGTH = 20;

export function hexToBytes(hex: string): Uint8Array {
  const parts = hex.trim().split(/\s+/).filter(Boolean);
  return Uint8Array.from(parts.map((p) => parseInt(p, 16)));
}

export function u32le(data: ArrayLike<number>, offset: number): number {
  return (
    (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
  );
}

/** Команда для кольца: всегда ровно 20 байт, хвост — нули. */
export function command(...bytes: number[]): Uint8Array {
  const out = new Uint8Array(PACKET_LENGTH);
  bytes.forEach((b, i) => {
    out[i] = b & 0xff;
  });
  return out;
}
