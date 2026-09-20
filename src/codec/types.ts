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
  /** Заголовок потока пульса: expected — сколько будет пакетов-отметок aa. */
  | { kind: 'heart'; phase: 'start'; expected: number }
  | { kind: 'heart'; phase: 'mark'; index: number }
  | { kind: 'heart'; phase: 'end' }
  | { kind: 'heart'; phase: 'data'; samples: HeartSample[] }
  | { kind: 'steps'; isDayEnd: boolean; samples: Sample[] }
  | { kind: 'sleep'; isDayEnd: boolean; samples: Sample[] }
  | { kind: 'summary'; isDayEnd: boolean; records: SummaryRecord[] }
  /** 0x06 — кольцо занято: надо ждать, а не повторять запрос. */
  | { kind: 'busy' }
  /** 0x14 — живой замер пульса с меткой времени. */
  | { kind: 'livePulse'; ts: number; value: number }
  /** 0x24 — комплексный живой замер. */
  | { kind: 'liveBiometrics'; pulse: number; systolic: number; diastolic: number }
  | { kind: 'activity'; steps: number; distanceM: number; calories: number }
  | { kind: 'battery'; percent: number }
  | { kind: 'functions'; mask: Uint8Array }
  | { kind: 'autoMeasureAck'; accepted: boolean }
  | { kind: 'archiveEnd' }
  | { kind: 'unknown'; code: number };
