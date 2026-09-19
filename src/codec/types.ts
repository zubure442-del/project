/** Точка данных: ts — кольцевая метка (см. time.ts). */
export interface Sample {
  ts: number;
  value: number;
}

export interface HeartSample extends Sample {
  /** Сырые подзамеры пакета — для диагностики. */
  raw: number[];
}

export interface SummaryRecord {
  ts: number;
  systolic: number | null;
  diastolic: number | null;
  stress: number | null;
  /** ммоль/л (в пакете значение ×10). */
  glucose: number | null;
  hrv: number | null;
}

export type Packet =
  | { kind: 'spo2'; slotStart: number; isDayEnd: boolean; samples: Sample[] }
  | { kind: 'heart'; phase: 'start' | 'end' }
  | { kind: 'heart'; phase: 'data'; samples: HeartSample[] }
  | { kind: 'steps'; samples: Sample[] }
  | { kind: 'sleep'; samples: Sample[] }
  | { kind: 'summary'; records: SummaryRecord[] }
  | { kind: 'activity'; steps: number; distanceM: number; calories: number }
  | { kind: 'battery'; percent: number }
  | { kind: 'functions'; mask: Uint8Array }
  | { kind: 'autoMeasureAck'; accepted: boolean }
  | { kind: 'archiveEnd' }
  | { kind: 'unknown'; code: number };
