/** Всё, что нужно слою выгрузки от BLE. Настоящая реализация — ring.ts, в тестах — подделка. */
export interface Transport {
  send(data: Uint8Array): Promise<void>;
  /** Подписка на входящие 20-байтовые пакеты. Возвращает функцию отписки. */
  onPacket(listener: (data: Uint8Array) => void): () => void;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
