import { BleError, BleErrorCode, BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import { PACKET_LENGTH } from '../codec';
import { base64ToBytes, bytesToBase64 } from './base64';
import { logPacket } from './log';
import { sleep, type Transport } from './transport';

export const RING_NAME = 'Vuelo Ring';
const NOTIFY_UUID = '000033f4-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '000033f3-0000-1000-8000-00805f9b34fb';
const SCAN_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 12000;
const BLUETOOTH_WAIT_MS = 10000;
const WRITE_GAP_MS = 80;
const WRITE_RETRIES = 2;
/** Идентификатор для восстановления состояния Bluetooth после выгрузки приложения из памяти. */
const RESTORE_ID = 'vuelo-ring-central';

export type RingStatus = 'idle' | 'bluetooth-off' | 'scanning' | 'connecting' | 'ready' | 'disconnected';

/** Что запоминаем о кольце, чтобы в следующий раз не искать его сканированием. */
export interface KnownRing {
  id: string;
  serviceUuid: string;
}

const isBleError = (e: unknown, code: number) => e instanceof BleError && e.errorCode === code;

/** UUID разной длины (например «33F4») приводим к полному нижнему регистру. */
function normalizeUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  return u.length === 4 ? `0000${u}-0000-1000-8000-00805f9b34fb` : u;
}

const matchesRing = (device: Device | null) =>
  (device?.name ?? device?.localName ?? '').trim().toLowerCase() === RING_NAME.toLowerCase();

/** Настоящий BLE-транспорт кольца. Работает только на реальном iPhone (development build). */
export class RingBle implements Transport {
  private manager: BleManager;
  private device: Device | null = null;
  private serviceUuid: string | null = null;
  /** Кольцо может принимать команды только «без подтверждения» — выбираем по свойствам характеристики. */
  private writeWithResponse = true;
  private listeners = new Set<(d: Uint8Array) => void>();
  private subscriptions: Subscription[] = [];
  private writeChain: Promise<unknown> = Promise.resolve();
  /** Связь держим: при обрыве переподключаемся сами, пока не попросили отключиться. */
  private keepConnected = false;
  private known: KnownRing | null;

  status: RingStatus = 'idle';
  onStatus: (s: RingStatus) => void = () => {};
  /** Вызывается, когда кольцо опознано: идентификатор стоит сохранить на телефоне. */
  onKnown: (known: KnownRing) => void = () => {};

  constructor(known: KnownRing | null = null) {
    this.known = known;
    this.manager = new BleManager({
      restoreStateIdentifier: RESTORE_ID,
      // iOS возвращает подключения, которые держала за нас, пока приложение было выгружено.
      restoreStateFunction: (restored) => {
        const device = restored?.connectedPeripherals?.[0];
        if (device) void this.attach(device).catch(() => undefined);
      },
    });
  }

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

  /** Связь жива и подписка на notify на месте. */
  private async isLive(): Promise<boolean> {
    if (!this.device || !this.serviceUuid || !this.subscriptions.length) return false;
    return this.device.isConnected().catch(() => false);
  }

  /** 1) Кольцо, которое iOS уже держит подключённым: сканированием его не найти, оно не рекламируется. */
  private async fromSystem(): Promise<Device | null> {
    if (!this.known) return null;
    const connected = await this.manager.connectedDevices([this.known.serviceUuid]).catch(() => []);
    return connected.find((d) => d.id === this.known?.id) ?? connected.find(matchesRing) ?? null;
  }

  /** 2) Известное кольцо по идентификатору: работает, даже когда оно молчит в эфире. */
  private async fromKnownId(): Promise<Device | null> {
    if (!this.known) return null;
    const [device] = await this.manager.devices([this.known.id]).catch(() => []);
    return device ?? null;
  }

  /** 3) Поиск по имени — только для первого знакомства. */
  private fromScan(): Promise<Device> {
    this.setStatus('scanning');
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        void this.manager.stopDeviceScan();
      };
      const timer = setTimeout(() => {
        stop();
        reject(new Error('Кольцо не найдено. Наденьте его, проверьте заряд и что оно не подключено к другому приложению.'));
      }, SCAN_TIMEOUT_MS);
      void this.manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          stop();
          reject(error);
        } else if (matchesRing(device) && device) {
          stop();
          resolve(device);
        }
      });
    });
  }

  /** Подключение, поиск характеристик и подписка на notify. */
  private async attach(target: Device): Promise<void> {
    this.setStatus('connecting');
    const device = await this.openConnection(target);
    await device.discoverAllServicesAndCharacteristics();

    // UUID сервиса в PROTOCOL.md не указан: находим сервис, где есть обе характеристики.
    this.serviceUuid = null;
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

    this.clearSubscriptions();
    this.device = device;
    this.keepConnected = true;
    this.known = { id: device.id, serviceUuid: this.serviceUuid };
    this.onKnown(this.known);

    this.subscriptions.push(
      this.manager.monitorCharacteristicForDevice(device.id, this.serviceUuid, NOTIFY_UUID, (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const bytes = base64ToBytes(characteristic.value);
        logPacket('in', bytes);
        this.listeners.forEach((l) => l(bytes));
      }),
      this.manager.onDeviceDisconnected(device.id, () => {
        this.clearSubscriptions();
        this.device = null;
        this.setStatus('disconnected');
        if (this.keepConnected) void this.reconnect(device.id);
      }),
    );
    this.setStatus('ready');
  }

  private async openConnection(device: Device): Promise<Device> {
    if (await device.isConnected().catch(() => false)) return device;
    try {
      return await device.connect();
    } catch (e) {
      // «Уже подключено» — не ошибка: продолжаем с тем же устройством.
      if (isBleError(e, BleErrorCode.DeviceAlreadyConnected)) return device;
      throw e;
    }
  }

  /**
   * Переподключение после обрыва. Запрос не отменяем и таймаут не ставим:
   * iOS держит его и соединит сама, как только кольцо окажется рядом.
   */
  private async reconnect(id: string): Promise<void> {
    try {
      const [device] = await this.manager.devices([id]);
      if (device && this.keepConnected) await this.attach(device);
    } catch {
      // Молча: попробуем снова при следующем «Обновить».
    }
  }

  /**
   * Подключение к кольцу. Порядок важен: уже подключённое устройство, затем известное
   * по идентификатору и только потом поиск по имени. Кольцо не рекламирует себя,
   * пока подключено, поэтому сканирование его не находит.
   * Рукопожатие (0x01, 0x19) делает вызывающий: см. handshake().
   */
  async connect(): Promise<void> {
    if (await this.isLive()) {
      this.setStatus('ready');
      return;
    }
    this.setStatus('idle');
    await this.waitPoweredOn();

    const target = (await this.fromSystem()) ?? (await this.fromKnownId());
    if (target) {
      try {
        await this.withTimeout(this.attach(target), CONNECT_TIMEOUT_MS);
        return;
      } catch {
        // Кольцо могло смениться или уйти из зоны: пробуем найти заново.
        this.known = null;
      }
    }
    await this.attach(await this.fromScan());
  }

  private async withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Кольцо не отвечает.')), ms);
    });
    try {
      return await Promise.race([task, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  private clearSubscriptions() {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
  }

  /** Явный разрыв связи. После него кольцо само подключаться не будет. */
  async disconnect(): Promise<void> {
    this.keepConnected = false;
    this.clearSubscriptions();
    const id = this.device?.id;
    this.device = null;
    this.serviceUuid = null;
    if (id) await this.manager.cancelDeviceConnection(id).catch(() => undefined);
    this.setStatus('idle');
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
        if (!device || !this.serviceUuid) throw new Error('Связь с кольцом потеряна. Нажмите «Обновить» ещё раз.');
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
          if (isBleError(e, BleErrorCode.OperationCancelled)) throw new Error('Выгрузка прервана.');
          if (isBleError(e, BleErrorCode.DeviceDisconnected)) throw new Error('Кольцо отключилось. Нажмите «Обновить» ещё раз.');
          await sleep(300);
        }
      }
      throw lastError;
    });
    this.writeChain = task.catch(() => undefined);
    return task;
  }
}
