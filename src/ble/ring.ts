import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import { PACKET_LENGTH } from '../codec';
import { base64ToBytes, bytesToBase64 } from './base64';
import { logPacket } from './log';
import { sleep, type Transport } from './transport';

export const RING_NAME = 'Vuelo Ring';
const NOTIFY_UUID = '000033f4-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '000033f3-0000-1000-8000-00805f9b34fb';
const SCAN_TIMEOUT_MS = 15000;
const BLUETOOTH_WAIT_MS = 10000;
const WRITE_GAP_MS = 80;
const WRITE_RETRIES = 2;

export type RingStatus = 'idle' | 'bluetooth-off' | 'scanning' | 'connecting' | 'ready' | 'disconnected';

/** UUID разной длины (например «33F4») приводим к полному нижнему регистру. */
function normalizeUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  return u.length === 4 ? `0000${u}-0000-1000-8000-00805f9b34fb` : u;
}

/** Настоящий BLE-транспорт кольца. Работает только на реальном iPhone (development build). */
export class RingBle implements Transport {
  private manager = new BleManager();
  private device: Device | null = null;
  private serviceUuid: string | null = null;
  /** Кольцо может принимать команды только «без подтверждения» — выбираем по свойствам характеристики. */
  private writeWithResponse = true;
  private listeners = new Set<(d: Uint8Array) => void>();
  private subscriptions: Subscription[] = [];
  private writeChain: Promise<unknown> = Promise.resolve();
  status: RingStatus = 'idle';
  onStatus: (s: RingStatus) => void = () => {};

  private setStatus(s: RingStatus) {
    this.status = s;
    this.onStatus(s);
  }

  /** Ждём включённый Bluetooth. Если он недоступен или выключен — понятная ошибка, а не вечное ожидание. */
  private waitPoweredOn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        sub.remove();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error('Bluetooth не включился. Включите его в Пункте управления и попробуйте снова.'))),
        BLUETOOTH_WAIT_MS,
      );
      const sub = this.manager.onStateChange((state) => {
        if (state === State.PoweredOn) {
          finish(resolve);
        } else if (state === State.Unsupported) {
          finish(() => reject(new Error('На этом устройстве нет Bluetooth. Кольцо работает только на настоящем iPhone, в симуляторе — нет.')));
        } else if (state === State.Unauthorized) {
          finish(() => reject(new Error('Приложению запрещён доступ к Bluetooth. Разрешите его в Настройках → Vuelo.')));
        } else if (state === State.PoweredOff) {
          this.setStatus('bluetooth-off');
        }
      }, true);
    });
  }

  private scan(): Promise<Device> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.manager.stopDeviceScan();
        reject(new Error('Кольцо не найдено. Наденьте его, проверьте заряд и что оно не подключено к другому приложению.'));
      }, SCAN_TIMEOUT_MS);
      void this.manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        const name = (device?.name ?? device?.localName ?? '').trim();
        if (device && name.toLowerCase() === RING_NAME.toLowerCase()) {
          clearTimeout(timer);
          void this.manager.stopDeviceScan();
          resolve(device);
        }
      });
    });
  }

  /** Поиск по имени, подключение, подписка на notify. Рукопожатие (0x01, 0x19) делает вызывающий: см. handshake(). */
  async connect(): Promise<void> {
    await this.disconnect();
    this.setStatus('idle');
    await this.waitPoweredOn();
    this.setStatus('scanning');
    const found = await this.scan();
    this.setStatus('connecting');
    const device = await found.connect();
    await device.discoverAllServicesAndCharacteristics();

    // UUID сервиса в PROTOCOL.md не указан: находим сервис, где есть обе характеристики.
    for (const service of await device.services()) {
      const characteristics = await service.characteristics();
      const byUuid = new Map(characteristics.map((c) => [normalizeUuid(c.uuid), c]));
      const write = byUuid.get(WRITE_UUID);
      if (!byUuid.has(NOTIFY_UUID) || !write) continue;
      this.serviceUuid = service.uuid;
      // Если характеристика не умеет запись с подтверждением, пишем без него — иначе кольцо не примет команду.
      this.writeWithResponse = write.isWritableWithResponse || !write.isWritableWithoutResponse;
    }
    if (!this.serviceUuid) throw new Error('У кольца не нашлись нужные характеристики (33f3/33f4).');

    this.device = device;
    this.subscriptions.push(
      this.manager.monitorCharacteristicForDevice(device.id, this.serviceUuid, NOTIFY_UUID, (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const bytes = base64ToBytes(characteristic.value);
        logPacket('in', bytes);
        this.listeners.forEach((l) => l(bytes));
      }),
      this.manager.onDeviceDisconnected(device.id, () => {
        this.device = null;
        this.setStatus('disconnected');
      }),
    );
    this.setStatus('ready');
  }

  async disconnect(): Promise<void> {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    const id = this.device?.id;
    this.device = null;
    this.serviceUuid = null;
    if (id) await this.manager.cancelDeviceConnection(id).catch(() => undefined);
  }

  onPacket(listener: (d: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Очередь: команды уходят строго по одной, с паузой, с повтором при сбое записи. */
  send(data: Uint8Array): Promise<void> {
    const task = this.writeChain.then(async () => {
      if (data.length !== PACKET_LENGTH) throw new Error(`Команда должна быть ${PACKET_LENGTH} байт, а не ${data.length}`);
      let lastError: unknown;
      for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const device = this.device;
        if (!device || !this.serviceUuid) throw new Error('Кольцо не подключено.');
        try {
          const payload = bytesToBase64(data);
          if (this.writeWithResponse) {
            await this.manager.writeCharacteristicWithResponseForDevice(device.id, this.serviceUuid, WRITE_UUID, payload);
          } else {
            await this.manager.writeCharacteristicWithoutResponseForDevice(device.id, this.serviceUuid, WRITE_UUID, payload);
          }
          logPacket('out', data);
          await sleep(WRITE_GAP_MS);
          return;
        } catch (e) {
          lastError = e;
          await sleep(300);
        }
      }
      throw lastError;
    });
    this.writeChain = task.catch(() => undefined);
    return task;
  }
}
