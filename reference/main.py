import asyncio
import os
import time
import struct
import csv
import statistics
from collections import Counter
import matplotlib
matplotlib.use('Agg')  
import matplotlib.pyplot as plt
from datetime import datetime, timezone, timedelta
from bleak import BleakScanner, BleakClient

RING_NAME = "Vuelo Ring"  
NOTIFY_UUID = "000033f4-0000-1000-8000-00805f9b34fb"
WRITE_UUID = "000033f3-0000-1000-8000-00805f9b34fb"

# Настройки автозамера пульса/SpO2, которые скрипт восстанавливает при КАЖДОМ подключении.
# Так делает и приложение производителя (DupMainActivity.initParam() вызывает
# setAutoHeartMode при каждом событии "подключено"): кольцо эту настройку теряет,
# и без переотправки оно перестаёт писать офлайн-SpO2.
AUTO_MEASURE_ON_CONNECT = True   # False - не трогать настройку кольца при подключении
AUTO_MEASURE_PERIOD_MIN = 30     # 15 / 30 / 45 / 60

class VueloRing:
    def __init__(self):
        self.client = None
        self.live_measurement_done = False
        self.live_measurement_target = None
        self.archive_done = False
        self.last_packet_time = 0
        self.expecting_activity = False
        
        self.gender = 'M' 
        self.age = 30
        self.weight = 75.0
        self.height = 175.0
        self.battery_level = "Неизвестно"
        
        self.hr_archive = {}
        self.hr_raw = {}              # время -> сырые подзамеры пульса из пакета 0x16 (для диагностики)
        self.sleep_archive = {}
        self.steps_archive = {}
        self.spo2_archive = {}
        self.bp_archive = {}
        self.sugar_archive = {}
        self.hrv_archive = {}

        # --- Состояние выгрузки SpO2 (команда 0x40) ---
        self.spo2_pkts_day = 0        # сколько пакетов 0x40 пришло на текущий запрос
        self.spo2_points_day = 0      # сколько валидных точек SpO2 из них извлечено
        self.spo2_last_rx = 0.0       # monotonic-время последнего пакета 0x40
        self.spo2_day_complete = False  # пришёл пакет блока 23:45 (конец суток)
        self.spo2_day_values = []     # значения SpO2, принятые за текущий запрос (для диагностики)
        self.spo2_pkts_bad = 0        # пакеты 0x40 с некорректным временем/длиной
        self.spo2_stats = {}          # день -> (пакетов 0x40, валидных точек SpO2)
        self.rx_capture = None        # список сырых пакетов, пока идёт запрос SpO2 (диагностика)

        self.stress_archive = {}      # индекс стресса из пакета 0x55 (это НЕ SpO2)
        self.band_function = None     # байты ответа 0x20 (набор функций кольца)
        self.auto_test_ack = None     # ответ на команду автозамера 0x19: True/False/None

    # Допустимые значения SpO2. Приложение производителя сохраняет любое значение
    # в диапазоне 1..100 (0 = "нет замера", 255 = "пусто"). Если нужен более
    # строгий фильтр, поставьте SPO2_MIN_VALID = 80.
    SPO2_MIN_VALID = 1
    SPO2_MAX_VALID = 100

    def _valid_spo2(self, value):
        return self.SPO2_MIN_VALID <= value <= self.SPO2_MAX_VALID

    SPO2_LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spo2_debug.log")

    def _handle_spo2_offline(self, data):
        """Разбор пакета 0x40 (офлайн-SpO2 за сутки), формат из приложения производителя:
        байты 1..4 - метка времени (uint32 LE, локальное время кольца),
        байты 5..19 - 15 значений SpO2, по одному на каждую минуту.
        Устройство шлёт по одному такому пакету на каждые 15 минут суток (до 96 шт.).
        Считаем ВСЕ пакеты 0x40 (даже с плохим временем), чтобы диагностика видела ответ кольца."""
        self.last_packet_time = time.time()
        self.spo2_last_rx = time.monotonic()
        self.spo2_pkts_day += 1
        print("🩸", end="", flush=True)
        if len(data) < 6:
            self.spo2_pkts_bad += 1
            return
        ts = struct.unpack('<I', data[1:5])[0]
        if ts <= 1000000000:
            self.spo2_pkts_bad += 1
            return

        # Как в приложении: пакет с блоком 23:45:00 - последний в сутках
        block_start = datetime.fromtimestamp(ts, timezone.utc)
        if block_start.hour == 23 and block_start.minute == 45 and block_start.second == 0:
            self.spo2_day_complete = True

        minutes = [(i, data[5 + i]) for i in range(min(15, len(data) - 5))
                   if data[5 + i] != 255 and self._valid_spo2(data[5 + i])]
        if not minutes:
            return   # пустой слот или маркер конца суток (23:45 с нулями)

        # Кольцо кладёт в 15-минутный слот ОДИН замер и дублирует его на все 15 минут
        # (в логе кольца это 15 одинаковых байт). Тогда это один замер, а не 15 точек.
        if len({v for _, v in minutes}) == 1:
            minutes = minutes[:1]

        for i, value in minutes:
            dt = datetime.fromtimestamp(ts + i * 60, timezone.utc).replace(tzinfo=None)
            self.spo2_archive[dt] = value
            self.spo2_points_day += 1
            self.spo2_day_values.append(value)

    async def sync_spo2_day(self, day_offset, first_packet_timeout=4.0, idle_timeout=2.0, retries=1):
        """Выгрузка SpO2 за один день (0 = сегодня, 1 = вчера, ...).

        Повторяет логику приложения: запрос 0x40 <день>; конец передачи определяется
        по паузе ~2 с после последнего пакета (или по пакету 23:45); если кольцо не
        ответило за 4-5 с, запрос отправляется повторно. Все сырые ответы кольца за это
        время пишутся в spo2_debug.log. Возвращает число пакетов 0x40."""
        packets = 0
        self.rx_capture = []
        self.spo2_pkts_bad = 0
        for attempt in range(retries + 1):
            self.spo2_pkts_day = 0
            self.spo2_points_day = 0
            self.spo2_day_values = []
            self.spo2_day_complete = False
            self.spo2_last_rx = 0.0
            started = time.monotonic()
            await self.send_cmd([0x40, day_offset])

            while True:
                await asyncio.sleep(0.05)
                now = time.monotonic()
                if self.spo2_pkts_day == 0:
                    # Ждём первый пакет (кольцу нужно время поднять данные из памяти)
                    if now - started > first_packet_timeout:
                        break
                else:
                    if now - self.spo2_last_rx > idle_timeout:
                        break
                    if self.spo2_day_complete and now - self.spo2_last_rx > 0.5:
                        break

            packets = self.spo2_pkts_day
            if packets > 0:
                break
            if attempt < retries:
                print(" (нет ответа на 0x40, повтор)", end="", flush=True)

        # Дадим дойти запоздавшим пакетам, пока не начался следующий запрос
        await asyncio.sleep(0.3)
        captured = self.rx_capture or []
        self.rx_capture = None

        replies = Counter(p[0] for p in captured if len(p))
        replies_txt = ", ".join(f"{op:02X}x{n}" for op, n in sorted(replies.items()))
        detail = f"пакетов {packets}"
        if self.spo2_pkts_bad:
            detail += f" (из них с битым временем {self.spo2_pkts_bad})"
        detail += f", точек {self.spo2_points_day}"
        if self.spo2_day_values:
            detail += f", значения {min(self.spo2_day_values)}-{max(self.spo2_day_values)}%"
        if replies_txt:
            detail += f" | ответы кольца: {replies_txt}"
        print(f" [SpO2: {detail}]", end="", flush=True)
        if packets == 0 and captured:
            for raw in captured[:2]:
                print(f"\n   ⚠️ пришло другое: {raw.hex(' ')}", end="", flush=True)

        self.spo2_stats[day_offset] = (packets, self.spo2_points_day, self.spo2_pkts_bad)
        self._write_spo2_log(day_offset, packets, captured)
        return packets

    def _write_spo2_log(self, day_offset, packets, captured):
        """Сырые ответы кольца на запрос SpO2 - для разбора, если данных нет."""
        try:
            with open(self.SPO2_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(f"=== {datetime.now():%Y-%m-%d %H:%M:%S} день -{day_offset}: "
                        f"пакетов 0x40 = {packets}, точек SpO2 = {self.spo2_points_day}, "
                        f"всего пакетов за окно = {len(captured)}\n")
                for raw in captured[:150]:
                    f.write(raw.hex(" ") + "\n")
        except Exception as e:
            print(f"\n⚠️ Не удалось записать {self.SPO2_LOG_FILE}: {e}")

    def print_spo2_summary(self):
        """Сводка замеров SpO2 из архива по дням и время последнего замера."""
        if not self.spo2_archive:
            return
        by_day = {}
        for dt, v in self.spo2_archive.items():
            by_day.setdefault(dt.date(), []).append(v)
        today = datetime.now().date()
        for d in sorted(by_day, reverse=True)[:7]:
            vals = by_day[d]
            label = "сегодня" if d == today else d.strftime("%d.%m")
            print(f"   {label}: замеров {len(vals)}, {min(vals)}-{max(vals)}%, среднее {sum(vals) / len(vals):.1f}%")
        last_dt, last_v = max(self.spo2_archive.items())
        print(f"   Последний замер: {last_dt:%d.%m %H:%M} - {last_v}%")
        if today not in by_day:
            print("   ℹ️ Сегодня кольцо ещё не записало ни одного замера SpO2. Оно пишет SpO2 не непрерывно, "
                  "а отдельными замерами (не чаще раза в 15 минут) и только когда замер удался: кольцо надето "
                  "плотно, рука неподвижна.")

    def print_spo2_verdict(self):
        """Короткий вывод по итогам выгрузки SpO2: где именно проблема."""
        if not self.spo2_stats:
            return
        total_pk = sum(v[0] for v in self.spo2_stats.values())
        total_pt = sum(v[1] for v in self.spo2_stats.values())
        total_bad = sum(v[2] for v in self.spo2_stats.values())
        days = len(self.spo2_stats)
        print("\n📋 Итог по SpO2:")
        if total_pk == 0:
            print("❌ Кольцо не ответило на запрос SpO2 (0x40) ни за один день. Либо эта прошивка не отдаёт "
                  "SpO2 в таком виде, либо ответ приходит в другом формате.")
        elif total_pt == 0:
            extra = " Пакеты приходят с некорректной меткой времени." if total_bad else ""
            print("⚠️ Кольцо отвечает, но записей SpO2 в его памяти нет (все значения нулевые)." + extra +
                  " Значит кольцо не записало SpO2: проверьте, что оно надето плотно, автозамер включён "
                  "(пункт 5), и подождите 1-2 часа. Если официальное приложение тоже не показывает SpO2 "
                  "за сегодня, данных нет на стороне самого кольца.")
        else:
            print(f"✅ SpO2 выгружен: {total_pt} замеров за {days} дн. (пакетов {total_pk}).")
        self.print_spo2_summary()
        print(f"📄 Сырые ответы кольца сохранены в {self.SPO2_LOG_FILE}")

    async def diagnose_spo2(self):
        """Быстрая проверка только SpO2 (0x40) за 3 дня, без полной синхронизации."""
        self.spo2_stats = {}
        print("\n🔬 Диагностика SpO2: запрашиваю 0x40 за 3 дня...")
        for day in range(3):
            print(f"\n👉 День -{day}: ", end="", flush=True)
            await self.sync_spo2_day(day, first_packet_timeout=5.0, retries=1)
            await asyncio.sleep(0.5)
        print()
        self.print_spo2_verdict()

    # --- Фильтр артефактов пульса ---
    # Сбой = одиночный (или из 2 замеров подряд) резкий скачок пульса вверх/вниз,
    # после которого пульс сразу возвращается к прежнему уровню. Реальная нагрузка так не
    # выглядит: пульс растёт постепенно и держится. Такие точки не попадают ни на график,
    # ни в расчёт индекса Vuelo (сырой self.hr_archive не меняется).
    HR_GLITCH_JUMP = 30      # насколько замер отличается от предыдущего "хорошего", уд/мин
    HR_GLITCH_RETURN = 15    # насколько близко к прежнему уровню пульс должен вернуться, уд/мин
    HR_GLITCH_MAX_RUN = 2    # максимум замеров подряд, которые считаем одним сбоем
    HR_GLITCH_MAX_GAP = 2400  # макс. разрыв между соседними замерами (сек) = 40 мин: с запасом для автозамера раз в 15-30 мин

    HR_MIN_VALID = 30        # подзамеры вне 30..220 - явный мусор датчика, не считаем
    HR_MAX_VALID = 220
    HR_DEBUG_JUMP = 20       # скачок (уд/мин), который пишем в hr_debug.log вместе с сырыми данными
    HR_DEBUG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hr_debug.log")

    def _hr_from_samples(self, samples):
        """Пульс за минуту из подзамеров пакета 0x16. Берём МЕДИАНУ, а не среднее: один
        кривой подзамер (например 30 или 150 среди шести по 78) сдвигает среднее на 8-12
        ударов, а медиану не трогает. Возвращает None, если годных подзамеров нет."""
        valid = [x for x in samples if self.HR_MIN_VALID <= x <= self.HR_MAX_VALID]
        if not valid:
            return None
        return round(statistics.median(valid))

    def write_hr_debug(self):
        """Пишет в hr_debug.log сырые подзамеры вокруг каждого резкого скачка пульса за
        сегодня, чтобы отличить реальное изменение пульса от сбоя датчика."""
        today = datetime.now().date()
        items = [(t, v) for t, v in sorted(self.hr_archive.items()) if t.date() == today]
        lines = []
        for k in range(1, len(items)):
            (t0, v0), (t1, v1) = items[k - 1], items[k]
            if (t1 - t0).total_seconds() <= self.HR_GLITCH_MAX_GAP and abs(v1 - v0) >= self.HR_DEBUG_JUMP:
                lines.append(f"{t0:%H:%M} {v0:>3} raw={self.hr_raw.get(t0, 'live')}  ->  "
                             f"{t1:%H:%M} {v1:>3} raw={self.hr_raw.get(t1, 'live')}")
        if not lines:
            return 0
        try:
            with open(self.HR_DEBUG_FILE, "w", encoding="utf-8") as f:
                f.write(f"=== {datetime.now():%Y-%m-%d %H:%M:%S} скачки пульса >= {self.HR_DEBUG_JUMP} уд/мин за сегодня\n")
                f.write("\n".join(lines) + "\n")
        except OSError:
            return 0
        return len(lines)

    def get_clean_hr(self):
        """Возвращает (очищенный_словарь_пульса, список_сбоев).
        Сбой - кортеж (время, значение, уровень_до, уровень_после).
        Последний замер в ряду проверить нельзя (нет следующего) - он остаётся."""
        items = sorted(self.hr_archive.items())
        n = len(items)
        glitches = []
        good = 0            # индекс последнего оставленного замера
        i = 1
        while i < n:
            t_base, base = items[good]
            t_i, v_i = items[i]
            if (t_i - t_base).total_seconds() > self.HR_GLITCH_MAX_GAP or abs(v_i - base) < self.HR_GLITCH_JUMP:
                good = i
                i += 1
                continue

            direction = 1 if v_i > base else -1
            matched_end = None
            for run in range(1, self.HR_GLITCH_MAX_RUN + 1):
                j = i + run                       # индекс первого замера ПОСЛЕ сбоя
                if j >= n:
                    break
                segment = items[i:j]
                if any(direction * (v - base) < self.HR_GLITCH_JUMP for _, v in segment):
                    break
                if any((items[k][0] - items[k - 1][0]).total_seconds() > self.HR_GLITCH_MAX_GAP
                       for k in range(i, j + 1)):
                    break
                after = items[j][1]
                if abs(after - base) <= self.HR_GLITCH_RETURN:
                    matched_end = j
                    break

            if matched_end is None:
                good = i          # это не сбой: пульс действительно изменился
                i += 1
            else:
                for t, v in items[i:matched_end]:
                    glitches.append((t, v, base, items[matched_end][1]))
                i = matched_end   # замер после сбоя проверяем относительно прежнего уровня

        bad_times = {g[0] for g in glitches}
        clean = {t: v for t, v in items if t not in bad_times}
        return clean, glitches

    def _band_flag(self, index):
        """Бит функции кольца из ответа 0x20 (нумерация как в приложении: байт = index // 8,
        бит = index % 8, младший бит первым)."""
        if not self.band_function:
            return None
        return bool((self.band_function[index // 8] >> (index % 8)) & 1)

    async def enable_auto_measurement(self, period_min=30, quiet=False):
        """Включает автоматический замер пульса/SpO2 на кольце (то же, что переключатель
        "Автотест пульса и кислорода" в приложении производителя): команда 0x19,
        окно 00:00-23:59, период 15/30/45/60 минут. Кольцо пишет данные само, LIVE-замер не нужен."""
        # 1) Узнаём, что кольцо умеет (ответ 0x20)
        self.band_function = None
        if quiet:
            self.auto_test_ack = None
            await self.send_cmd([0x19, 0, 0, 23, 59, 1, period_min % 255, 1])
            for _ in range(50):
                if self.auto_test_ack is not None:
                    break
                await asyncio.sleep(0.1)
            if self.auto_test_ack:
                print(f"🔄 Автозамер подтверждён кольцом: каждые {period_min} мин, круглосуточно.")
            elif self.auto_test_ack is False:
                print("⚠️ Кольцо отклонило настройку автозамера (0x99).")
            else:
                print("⚠️ Кольцо не подтвердило настройку автозамера (нет ответа 0x19).")
            return
        await self.send_cmd([0x20])
        for _ in range(40):
            if self.band_function: break
            await asyncio.sleep(0.1)
        if self.band_function:
            print(f"ℹ️ Кольцо: замер SpO2 {'есть' if self._band_flag(29) else 'НЕ заявлен'}, "
                  f"офлайн-хранение SpO2 {'есть' if self._band_flag(81) else 'НЕ заявлено'}")
        else:
            print("ℹ️ Кольцо не ответило на запрос функций (0x20), продолжаю без проверки.")

        # 2) Включаем автозамер
        self.auto_test_ack = None
        await self.send_cmd([0x19, 0, 0, 23, 59, 1, period_min % 255, 1])
        for _ in range(50):
            if self.auto_test_ack is not None: break
            await asyncio.sleep(0.1)
        if self.auto_test_ack:
            print(f"✅ Автозамер включён: каждые {period_min} мин, круглосуточно. "
                  f"Данные появятся в выгрузке через несколько часов.")
        elif self.auto_test_ack is False:
            print("❌ Кольцо отклонило команду автозамера (0x99).")
        else:
            print("⚠️ Кольцо не подтвердило команду автозамера (нет ответа 0x19).")

    def handle_rx(self, sender, data):
        if self.rx_capture is not None:
            self.rx_capture.append(bytes(data))
        if len(data) < 2: return
        cmd = data[0]

        if cmd == 0x03 and len(data) >= 17:
            if self.expecting_activity:
                steps = struct.unpack('<I', data[5:9])[0]
                distance = struct.unpack('<I', data[9:13])[0]
                calories = struct.unpack('<I', data[13:17])[0]
                print(f"\n🏃 АКТИВНОСТЬ (Сегодня) | Шаги: {steps} | Дистанция: {distance}м | Калории: {calories} ккал")
                self.expecting_activity = False

        elif cmd == 0x24 and len(data) >= 8:
            hr, sys, dia, spo2 = data[1], data[2], data[3], data[4]
            sugar = data[7] / 10.0
            hrv = data[8]
            
            is_bp_ready = (self.live_measurement_target == 'bp' and sys > dia > 0)
            is_sugar_ready = (self.live_measurement_target == 'sugar' and sugar > 0)
            
            if hr > 0 and (is_bp_ready or is_sugar_ready):
                print(" " * 60, end="\r")
                print(f"\n🩺 РЕЗУЛЬТАТ | ❤️ {hr} BPM | 💓 {sys}/{dia} mmHg | 🩸 SpO2: {spo2}% | 🍬 Глюкоза: {sugar:.1f} ммоль/л | ⚡ HRV: {hrv} ms")
                self.live_measurement_done = True
                
                # --- ИСПРАВЛЕНИЕ SpO2 ---
                # Сохраняем ручной замер в память, чтобы он не пропал на графиках и в индексе!
                now_dt = datetime.now()
                self.hr_archive[now_dt] = hr
                if sys > dia > 0: self.bp_archive[now_dt] = (sys, dia)
                if 80 <= spo2 <= 100: self.spo2_archive[now_dt] = spo2
                if sugar > 0: self.sugar_archive[now_dt] = sugar
                if hrv > 0: self.hrv_archive[now_dt] = hrv
            else:
                print(f"⏳ Сбор биометрии... (Пульс: {hr})", end="\r")

        # ИСПРАВЛЕНО: Считывание заряда батареи из команды 0x0b как в реализация зарядки.py
        elif cmd == 0x0b:
            if len(data) >= 2:
                self.battery_level = f"{data[1]}%"

        elif cmd == 0x16:
            self.last_packet_time = time.time()
            if len(data) > 1:
                subcmd = data[1]
                if subcmd == 0xf0:
                    self.archive_done = False
                elif subcmd == 0xa0 and len(data) >= 20:
                    print("♥", end="", flush=True) 
                    ts = struct.unpack('<I', data[2:6])[0]
                    if ts > 1000000000:
                        dt = datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None)
                        raw1 = list(data[8:14])
                        hr1 = self._hr_from_samples(raw1)
                        if hr1:
                            self.hr_archive[dt] = hr1
                            self.hr_raw[dt] = raw1
                            
                        raw2 = list(data[14:20])
                        hr2 = self._hr_from_samples(raw2)
                        if hr2:
                            dt2 = datetime.fromtimestamp(ts + 60, timezone.utc).replace(tzinfo=None)
                            self.hr_archive[dt2] = hr2
                            self.hr_raw[dt2] = raw2
                elif subcmd == 0xff:
                    self.archive_done = True

        elif cmd == 0x11:
            self.last_packet_time = time.time()
            if len(data) >= 6:
                ts = struct.unpack('<I', data[1:5])[0]
                if ts > 1000000000: 
                    print("🌙", end="", flush=True)
                    num_records = len(data) - 5
                    for i in range(num_records):
                        state = data[5+i]
                        if state != 255: 
                            dt = datetime.fromtimestamp(ts + i * 60, timezone.utc).replace(tzinfo=None)
                            self.sleep_archive[dt] = state

        elif cmd == 0x10:
            self.last_packet_time = time.time()
            if len(data) >= 6:
                ts = struct.unpack('<I', data[1:5])[0]
                if ts > 1000000000: 
                    print("👣", end="", flush=True)
                    num_records = len(data) - 5
                    for i in range(num_records):
                        steps = data[5+i]
                        if steps != 255 and steps > 0: 
                            dt = datetime.fromtimestamp(ts + i * 60, timezone.utc).replace(tzinfo=None)
                            self.steps_archive[dt] = steps

        elif cmd == 0x40:
            self._handle_spo2_offline(data)

        elif cmd == 0x55:
            self.last_packet_time = time.time()
            if len(data) >= 6:
                ts = struct.unpack('<I', data[1:5])[0]
                if ts > 1000000000: 
                    print("💓", end="", flush=True)
                    num_records = (len(data) - 5) // 5
                    for i in range(num_records):
                        sys = data[5 + i*5]
                        dia = data[6 + i*5]
                        # ВНИМАНИЕ: третье поле записи 0x55 - это ИНДЕКС СТРЕССА (в приложении
                        # производителя тип 17 "pressure"), а не SpO2. SpO2 в этом пакете нет.
                        stress = data[7 + i*5]
                        sugar_raw = data[8 + i*5]
                        hrv = data[9 + i*5]
                        
                        dt = datetime.fromtimestamp(ts + i * 900, timezone.utc).replace(tzinfo=None)

                        if sys != 255 and dia != 255 and sys > dia > 0:
                            self.bp_archive[dt] = (sys, dia)
                            
                        if stress != 255 and 0 < stress <= 100:
                            self.stress_archive[dt] = stress

                        if sugar_raw != 255 and sugar_raw > 0:
                            self.sugar_archive[dt] = sugar_raw / 10.0 
                            
                        if hrv != 255 and hrv > 0:
                            self.hrv_archive[dt] = hrv

        elif cmd == 0x20 and len(data) >= 13:
            self.band_function = bytes(data[1:13])

        elif cmd == 0x19:
            self.auto_test_ack = True
        elif cmd == 0x99:
            self.auto_test_ack = False

        elif cmd in (0x90, 0x91):
            self.archive_done = True

    def generate_graph(self, archive_dict, title, ylabel, filename_prefix, color='r'):
        if not archive_dict: return
        sorted_items = sorted(archive_dict.items())
        times = [item[0] for item in sorted_items] 
        values = [item[1] for item in sorted_items]

        plt.figure(figsize=(10, 5))
        plt.plot(times, values, marker='o', linestyle='-', color=color, markersize=3)
        plt.title(title); plt.xlabel('Время'); plt.ylabel(ylabel)
        plt.grid(True); plt.xticks(rotation=45); plt.tight_layout()
        filename = f"{filename_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        plt.savefig(filename)
        print(f"🖼️ Сохранен график: {filename}")
        plt.close()

    HR_SMOOTH_HALF_WINDOW = 2700   # сглаживание пульса: медиана замеров в окне +-45 минут
    HR_SMOOTH_MAX_GAP = 5400       # разрыв между замерами больше 90 минут - линию не тянем

    def smooth_hr(self, items):
        """Скользящая медиана по времени. Одиночный выброс среди соседних замеров не влияет
        на медиану, а долгий подъём пульса - влияет. items: отсортированный [(время, пульс)]."""
        out = []
        for t, _ in items:
            window = [v for tt, v in items
                      if abs((tt - t).total_seconds()) <= self.HR_SMOOTH_HALF_WINDOW]
            out.append((t, statistics.median(window)))
        return out

    def generate_hr_graph(self, hr_dict, title, filename_prefix):
        """График пульса: бледные точки - сами замеры, яркая линия - сглаженная медиана.
        Линия рвётся там, где замеров не было дольше 90 минут (данных нет - не рисуем)."""
        if not hr_dict: return
        items = sorted(hr_dict.items())
        smooth = self.smooth_hr(items)

        plt.figure(figsize=(10, 5))
        plt.plot([t for t, _ in items], [v for _, v in items], 'o', color='lightcoral',
                 alpha=0.45, markersize=3, label='замеры')
        segment = []
        first = True
        def flush(seg, first_flag):
            lbl = 'сглаженный (медиана ±45 мин)' if first_flag else None
            if len(seg) == 1:
                plt.plot([seg[0][0]], [seg[0][1]], 'o', color='red', markersize=5, label=lbl)
            else:
                plt.plot([t for t, _ in seg], [v for _, v in seg], '-', color='red', linewidth=2, label=lbl)
        for pt in smooth:
            if segment and (pt[0] - segment[-1][0]).total_seconds() > self.HR_SMOOTH_MAX_GAP:
                flush(segment, first); first = False; segment = []
            segment.append(pt)
        if segment:
            flush(segment, first)
        plt.title(title); plt.xlabel('Время'); plt.ylabel('BPM')
        plt.legend(loc='best'); plt.grid(True); plt.xticks(rotation=45); plt.tight_layout()
        filename = f"{filename_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        plt.savefig(filename)
        print(f"🖼️ Сохранен график: {filename}")
        plt.close()

    def generate_bp_graph(self, archive_dict, title, ylabel, filename_prefix):
        if not archive_dict: return
        sorted_items = sorted(archive_dict.items())
        times = [item[0] for item in sorted_items] 
        sys_vals = [item[1][0] for item in sorted_items]
        dia_vals = [item[1][1] for item in sorted_items]

        plt.figure(figsize=(10, 5))
        plt.plot(times, sys_vals, marker='v', linestyle='-', color='r', label='Систолическое (Верхнее)', markersize=4)
        plt.plot(times, dia_vals, marker='^', linestyle='-', color='b', label='Диастолическое (Нижнее)', markersize=4)
        plt.title(title); plt.xlabel('Время'); plt.ylabel(ylabel)
        plt.legend(); plt.grid(True); plt.xticks(rotation=45); plt.tight_layout()
        filename = f"{filename_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        plt.savefig(filename)
        print(f"🖼️ Сохранен график: {filename}")
        plt.close()

    def generate_sleep_graph(self, archive_dict, title, filename_prefix):
        if not archive_dict: return
        
        sorted_items = sorted(archive_dict.items())
        daily_sleep = {}
        
        curr_deep = 0
        curr_light = 0
        curr_end = None
        last_t = None
        
        for t, state in sorted_items:
            if last_t and (t - last_t).total_seconds() > 7200:
                if curr_end:
                    target_date = curr_end.date()
                    if target_date not in daily_sleep:
                        daily_sleep[target_date] = {'deep': 0, 'light': 0}
                    daily_sleep[target_date]['deep'] += curr_deep
                    daily_sleep[target_date]['light'] += curr_light
                
                curr_deep = 0
                curr_light = 0
                
            if state >= 80: curr_deep += 1
            elif state >= 1: curr_light += 1
            
            last_t = t
            curr_end = t
            
        if curr_end:
            target_date = curr_end.date()
            if target_date not in daily_sleep:
                daily_sleep[target_date] = {'deep': 0, 'light': 0}
            daily_sleep[target_date]['deep'] += curr_deep
            daily_sleep[target_date]['light'] += curr_light

        if not daily_sleep: return

        sorted_dates = sorted(daily_sleep.keys())
        dates_str = [d.strftime('%d.%m') for d in sorted_dates]
        deep_hours = [daily_sleep[d]['deep'] / 60.0 for d in sorted_dates]
        light_hours = [daily_sleep[d]['light'] / 60.0 for d in sorted_dates]

        fig, ax = plt.subplots(figsize=(10, 5))
        
        bars_deep = ax.bar(dates_str, deep_hours, color='red', label='Глубокий сон')
        bars_light = ax.bar(dates_str, light_hours, bottom=deep_hours, color='forestgreen', label='Легкий сон')
        
        ax.set_yticks([0, 2, 4, 6, 8, 10])
        ax.set_yticklabels(['', '', '4 часа', '', '8 часов', ''], color='red')
        ax.grid(axis='y', linestyle='--', alpha=0.7)
        ax.set_ylim(0, max(max([d+l for d, l in zip(deep_hours, light_hours)] + [8.5]), 8.5)) 
        
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)

        for i in range(len(dates_str)):
            dh = deep_hours[i]
            lh = light_hours[i]
            total_h = dh + lh
            
            if total_h > 0:
                dp = int(round((dh / total_h) * 100))
                lp = int(round((lh / total_h) * 100))
                
                if dh > 0.5:
                    ax.text(i, dh / 2, f"Глубокий сон\n{dp}%", ha='center', va='center', color='red',
                            bbox=dict(facecolor='white', edgecolor='none', pad=3))
                
                if lh > 0.5:
                    ax.text(i, dh + (lh / 2), f"Легкий сон\n{lp}%", ha='center', va='center', color='red',
                            bbox=dict(facecolor='white', edgecolor='none', pad=3))

        plt.title(title)
        plt.tight_layout()
        
        filename = f"{filename_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        plt.savefig(filename)
        print(f"🖼️ Сохранен столбчатый график сна: {filename}")
        plt.close()

    def generate_steps_graph(self, archive_dict, title, filename_prefix):
        if not archive_dict: return
        
        daily_steps = {}
        for dt, steps in sorted(archive_dict.items()):
            target_date = dt.date()
            if target_date not in daily_steps:
                daily_steps[target_date] = 0
            daily_steps[target_date] += steps
            
        if not daily_steps: return

        sorted_dates = sorted(daily_steps.keys())
        dates_str = [d.strftime('%d.%m') for d in sorted_dates]
        steps_vals = [daily_steps[d] for d in sorted_dates]

        fig, ax = plt.subplots(figsize=(10, 5))
        bars = ax.bar(dates_str, steps_vals, color='orange', label='Шаги')
        
        for bar in bars:
            yval = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2.0, yval, f'{int(yval)}', ha='center', va='bottom', color='black')

        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        plt.title(title)
        plt.xlabel('Дата')
        plt.ylabel('Количество шагов')
        plt.grid(axis='y', linestyle='--', alpha=0.5)
        plt.tight_layout()
        
        filename = f"{filename_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        plt.savefig(filename)
        print(f"🖼️ Сохранен график шагов: {filename}")
        plt.close()

    def export_sleep_csv(self, archive_dict, filename_prefix):
        if not archive_dict: return
        filename = f"{filename_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f, delimiter=';')
            writer.writerow(['Время', 'Сырое значение (байт)', 'Фаза сна'])
            for t, state in sorted(archive_dict.items()):
                phase = "Глубокий" if state >= 80 else ("Легкий" if state >= 1 else "Бодрствование")
                writer.writerow([t.strftime('%Y-%m-%d %H:%M:%S'), state, phase])
        print(f"📁 Экспортированы данные сна (CSV): {filename}")

    async def send_cmd(self, cmd_bytes):
        cmd = bytearray(20)
        for i, b in enumerate(cmd_bytes): cmd[i] = b
        await self.client.write_gatt_char(WRITE_UUID, cmd)

    async def sync_time(self):
        cmd = bytearray(20)
        cmd[0] = 0x01
        offset = -time.altzone if time.localtime().tm_isdst else -time.timezone
        local_time_epoch = int(time.time() + offset)
        cmd[1:5] = struct.pack('<I', local_time_epoch)
        cmd[5] = (offset // 3600) & 0xFF
        await self.send_cmd(cmd)
        await asyncio.sleep(1)

    def calculate_vuelo_score(self):
        print("\n" + "="*45)
        print("🔥 ИНДЕКС VUELO (УЛЬТРА-ЖЕСТКАЯ ПЕССИМИСТИЧНАЯ МОДЕЛЬ)")
        print("="*45)
        
        now = datetime.now()
        today = now.date()
        max_hr = 208 - 0.7 * self.age

        # --- 1. ФУНДАМЕНТ (Дает максимум 15% от итоговой оценки) ---
        sorted_sleep = sorted(self.sleep_archive.items())
        daily_sleep = {}
        last_t, curr_end = None, None
        curr_deep, curr_light = 0, 0
        
        for t, state in sorted_sleep:
            if last_t and (t - last_t).total_seconds() > 7200:
                if curr_end:
                    d = curr_end.date()
                    if d not in daily_sleep: daily_sleep[d] = {'deep': 0, 'light': 0}
                    daily_sleep[d]['deep'] += curr_deep
                    daily_sleep[d]['light'] += curr_light
                curr_deep, curr_light = 0, 0
            if state >= 80: curr_deep += 1
            elif state >= 1: curr_light += 1
            last_t, curr_end = t, t
            
        if curr_end:
            d = curr_end.date()
            if d not in daily_sleep: daily_sleep[d] = {'deep': 0, 'light': 0}
            daily_sleep[d]['deep'] += curr_deep
            daily_sleep[d]['light'] += curr_light

        today_sleep = daily_sleep.get(today, {'deep': 0, 'light': 0})
        deep_min = today_sleep['deep']
        light_min = today_sleep['light']
        total_sleep_min = deep_min + light_min
        
        if total_sleep_min > 0:
            vol_score = min(100, (total_sleep_min / 420.0) * 100) 
            deep_ratio = deep_min / total_sleep_min
            qual_score = 100 if 0.15 <= deep_ratio <= 0.25 else max(0, 100 - abs(0.20 - deep_ratio) * 400)
            base_sleep = (vol_score * 0.7) + (qual_score * 0.3)
            sleep_info = f"{total_sleep_min//60}ч {total_sleep_min%60}м (Глубокий: {deep_min}м)"
        else:
            base_sleep = 0
            sleep_info = "Нет данных"

        spo2_today = [val for dt, val in self.spo2_archive.items() if dt.date() == today]
        avg_spo2 = sum(spo2_today)/len(spo2_today) if spo2_today else None
        spo2_score = 100 if avg_spo2 and avg_spo2 >= 95 else (max(0, 100 - (95 - avg_spo2)*20) if avg_spo2 else 0)
        
        hrv_today = [val for dt, val in self.hrv_archive.items() if dt.date() == today]
        avg_hrv = sum(hrv_today)/len(hrv_today) if hrv_today else None
        hrv_score = min(100, (avg_hrv / 65.0) * 100) if avg_hrv else 0
        
        kinetic_reserve = (base_sleep * 0.6) + (hrv_score * 0.2) + (spo2_score * 0.2)

        # --- 2. ДЕЙСТВИЕ / АКТИВНОСТЬ (Дает максимум 70% от итоговой оценки) ---
        steps_today = sum(count for dt, count in self.steps_archive.items() if dt.date() == today)
        step_score = min(100, (steps_today / 10000.0) * 100)
        
        clean_hr, _ = self.get_clean_hr()
        hr_today = [val for dt, val in clean_hr.items() if dt.date() == today]
        cardio_score = 0
        zone_mins = {"peak": 0, "anaerobic": 0, "aerobic": 0}
        if hr_today:
            for hr in hr_today:
                percent = hr / max_hr
                if percent > 0.85: zone_mins["peak"] += 1; cardio_score += 2.0
                elif percent > 0.70: zone_mins["anaerobic"] += 1; cardio_score += 1.0
                elif percent > 0.60: zone_mins["aerobic"] += 1; cardio_score += 0.5
        
        active_strain = min(100, (step_score * 0.7) + (cardio_score * 4))

        # --- 3. МЕТАБОЛИЗМ (Дает 15%, но может жестоко штрафовать) ---
        bp_today = [(dt, sys, dia) for dt, (sys, dia) in self.bp_archive.items() if dt.date() == today]
        sugar_today = [val for dt, val in self.sugar_archive.items() if dt.date() == today]
        
        avg_sugar, avg_sys, avg_dia = None, None, None
        
        sugar_score = 0
        if sugar_today:
            avg_sugar = sum(sugar_today)/len(sugar_today)
            if avg_sugar <= 5.2: sugar_score = 100
            else: sugar_score = max(0, 100 - (avg_sugar - 5.2) * 40)
            
        bp_score = 0
        if bp_today:
            avg_sys = sum(item[1] for item in bp_today)/len(bp_today)
            avg_dia = sum(item[2] for item in bp_today)/len(bp_today)
            if avg_sys < 120 and avg_dia < 80: bp_score = 100
            elif avg_sys <= 130 and avg_dia <= 85: bp_score = 70
            else: bp_score = max(0, 100 - (avg_sys - 130)*5)
            
        metabolic_score = (sugar_score * 0.5) + (bp_score * 0.5)

        # --- 4. ЖЕСТКАЯ СБОРКА ИТОГА ---
        vuelo_score = (kinetic_reserve * 0.15) + (active_strain * 0.70) + (metabolic_score * 0.15)
        
        penalty = 1.0
        if avg_sugar and avg_sugar > 6.0:
            penalty -= (avg_sugar - 6.0) * 0.4
            
        if total_sleep_min > 0 and total_sleep_min < 240:
            penalty -= 0.2
            
        vuelo_score = max(0, vuelo_score * penalty)

        print(f"🪫 Ресурс при пробуждении (Макс 15 баллов): {int(kinetic_reserve * 0.15)} / 15")
        print(f"   Сон: {sleep_info}")
        spo2_str = f"{avg_spo2:.1f}%" if avg_spo2 else "--%"
        hrv_str = f"{int(avg_hrv)} ms" if avg_hrv else "-- ms"
        print(f"   HRV: {hrv_str} | SpO2: {spo2_str}")
        
        print(f"🔥 Активность (Макс 70 баллов): {int(active_strain * 0.70)} / 70")
        print(f"   Шаги: {steps_today} / 10000")
        
        print(f"🧬 Метаболизм (Макс 15 баллов): {int(metabolic_score * 0.15)} / 15")
        sugar_str = f"{avg_sugar:.1f} ммоль/л" if avg_sugar else "--"
        bp_str = f"{int(avg_sys)}/{int(avg_dia)} mmHg" if bp_today else "--/--"
        print(f"   Глюкоза: {sugar_str} | Давление: {bp_str}")

        print("-" * 45)
        print(f"🏆 ИНДЕКС VUELO (Zero-Advance): {int(vuelo_score)} / 100")
        print("="*45 + "\n")

    async def interactive_loop(self):
        loop = asyncio.get_event_loop()
        while True:
            print("\n" + "="*40)
            print("💎 VUELO RING CORE SDK")
            print(f"🔋 Заряд кольца: {self.battery_level}")
            print("0. Настроить профиль (Биометрия)")
            print("1. Текущая активность (Шаги/Ккал)")
            print("2. Измерить пульс, давление, SpO2, Глюкозу и HRV (LIVE)")
            print("3. СИНХРОНИЗИРОВАТЬ И РАССЧИТАТЬ ИНДЕКС VUELO")
            print("5. Включить автозамер пульса/SpO2 на кольце")
            print("6. Диагностика SpO2 (быстро, только 0x40)")
            print("4. Выход")
            print("="*40)
            
            choice = await loop.run_in_executor(None, input, "Выберите команду (0-6): ")
            
            if choice == '0':
                try:
                    self.gender = await loop.run_in_executor(None, input, "Пол (M/F) [Текущий: M]: ") or 'M'
                    self.age = int(await loop.run_in_executor(None, input, f"Возраст [Текущий: {self.age}]: ") or self.age)
                    self.weight = float(await loop.run_in_executor(None, input, f"Вес (кг) [Текущий: {self.weight}]: ") or self.weight)
                    self.height = float(await loop.run_in_executor(None, input, f"Рост (см) [Текущий: {self.height}]: ") or self.height)
                    print("✅ Профиль обновлен!")
                except ValueError:
                    print("❌ Ошибка ввода. Попробуйте еще раз.")

            elif choice == '1':
                self.expecting_activity = True
                await self.send_cmd([0x03])
                await asyncio.sleep(1)
                self.expecting_activity = False
                
            elif choice == '2':
                self.live_measurement_done = False
                self.live_measurement_target = 'bp'
                print("🔵 Включаем зеленую оптику (SpO2 + BP)... Сидите неподвижно.")
                await self.send_cmd([0x23, 0x02])
                for _ in range(60):
                    if self.live_measurement_done: break
                    await asyncio.sleep(1)
                await self.send_cmd([0x23, 0x00])

                self.live_measurement_done = False
                self.live_measurement_target = 'sugar'
                print("🟠 Переключаем на спектральный сенсор (Глюкоза/HRV)... Не двигайте рукой.")
                await self.send_cmd([0x23, 0x03])
                for _ in range(60):
                    if self.live_measurement_done: break
                    await asyncio.sleep(1)
                await self.send_cmd([0x23, 0x00])
                
            elif choice == '3':
                # --- ИСПРАВЛЕНИЕ SpO2 ---
                # Мы БОЛЬШЕ НЕ ОЧИЩАЕМ словари (self.spo2_archive = {} и т.д.), 
                # чтобы сохранить ручные замеры, сделанные через команду "2".
                print("\n🚀 Запуск выгрузки (запрашиваем данные за 7 дней)...")
                self.spo2_stats = {}
                
                await self.send_cmd([0x13])
                await asyncio.sleep(0.5)

                spo2_answered = False
                for day_offset in range(7):
                    print(f"\n👉 День -{day_offset}: ", end="", flush=True)

                    self.last_packet_time = time.time()
                    self.archive_done = False
                    await self.send_cmd([0x10, day_offset]) 
                    while True:
                        await asyncio.sleep(0.1)
                        if self.archive_done or (time.time() - self.last_packet_time > 2.5): break
                    await asyncio.sleep(0.5) 

                    self.last_packet_time = time.time()
                    self.archive_done = False
                    await self.send_cmd([0x11, day_offset]) 
                    while True:
                        await asyncio.sleep(0.1)
                        if self.archive_done or (time.time() - self.last_packet_time > 2.5): break
                    await asyncio.sleep(0.5) 
                    
                    self.last_packet_time = time.time()
                    self.archive_done = False
                    await self.send_cmd([0x16, day_offset]) 
                    while True:
                        await asyncio.sleep(0.1)
                        if self.archive_done or (time.time() - self.last_packet_time > 2.5): break
                    await asyncio.sleep(0.5) 

                    # SpO2 за день (0x40): отдельная выгрузка с ожиданием первого пакета,
                    # повтором запроса и определением конца по паузе/пакету 23:45
                    patient = spo2_answered or day_offset == 0
                    got_packets = await self.sync_spo2_day(
                        day_offset,
                        first_packet_timeout=4.0 if patient else 2.0,
                        retries=1 if patient else 0)
                    if got_packets:
                        spo2_answered = True
                    await asyncio.sleep(0.5) 

                    self.last_packet_time = time.time()
                    self.archive_done = False
                    await self.send_cmd([0x55, day_offset]) 
                    while True:
                        await asyncio.sleep(0.1)
                        if self.archive_done or (time.time() - self.last_packet_time > 2.5): break
                    await asyncio.sleep(0.5) 

                print(f"\n\n🏁 Синхронизация завершена!")
                self.print_spo2_verdict()

                _, hr_glitches = self.get_clean_hr()
                if hr_glitches:
                    print(f"🧹 Отфильтровано артефактов пульса: {len(hr_glitches)} (не попадут на график и в индекс)")
                    for t, v, before, after in [g for g in hr_glitches if g[0].date() == datetime.now().date()][:10]:
                        print(f"   {t.strftime('%H:%M')} — {v} уд/мин (было {before}, стало {after})")
                
                jumps = self.write_hr_debug()
                if jumps:
                    print(f"🔎 Резких скачков пульса (от {self.HR_DEBUG_JUMP} уд/мин) за сегодня: {jumps}. "
                          f"Сырые подзамеры сохранены в {self.HR_DEBUG_FILE}")

                self.calculate_vuelo_score()

                today_date = datetime.now().date()
                
                clean_hr, _ = self.get_clean_hr()
                if clean_hr:
                    hr_today = {dt: val for dt, val in clean_hr.items() if dt.date() == today_date}
                    if hr_today:
                        self.generate_hr_graph(hr_today, 'Динамика пульса (Сегодня)', 'hr_today')

                if self.hrv_archive:
                    hrv_today = {dt: val for dt, val in self.hrv_archive.items() if dt.date() == today_date}
                    if hrv_today:
                        self.generate_graph(hrv_today, 'Вариабельность сердечного ритма HRV (Сегодня)', 'ms', 'hrv_today', color='teal')

                if self.spo2_archive:
                    spo2_today = {dt: val for dt, val in self.spo2_archive.items() if dt.date() == today_date}
                    if spo2_today:
                        self.generate_graph(spo2_today, 'Сатурация SpO2 (Сегодня)', '%', 'spo2_today', color='purple')
                    else:
                        recent_from = datetime.now() - timedelta(days=3)
                        spo2_recent = {dt: val for dt, val in self.spo2_archive.items() if dt >= recent_from}
                        if spo2_recent:
                            print("ℹ️ Сегодня замеров SpO2 нет, строю график за последние 3 дня.")
                            self.generate_graph(spo2_recent, 'Сатурация SpO2 (последние 3 дня)', '%', 'spo2_recent', color='purple')

                if self.bp_archive:
                    bp_today = {dt: val for dt, val in self.bp_archive.items() if dt.date() == today_date}
                    if bp_today:
                        self.generate_bp_graph(bp_today, 'Артериальное давление (Сегодня)', 'mmHg', 'bp_today')

                if self.sugar_archive:
                    sugar_today = {dt: val for dt, val in self.sugar_archive.items() if dt.date() == today_date}
                    if sugar_today:
                        self.generate_graph(sugar_today, 'Уровень глюкозы (Сегодня)', 'ммоль/л', 'sugar_today', color='orange')
                        
                if self.sleep_archive:
                    weeks_data = {}
                    for dt, state in self.sleep_archive.items():
                        iso_year, iso_week, _ = dt.isocalendar()
                        week_label = f"{iso_year}_W{iso_week:02d}"
                        if week_label not in weeks_data:
                            weeks_data[week_label] = {}
                        weeks_data[week_label][dt] = state
                        
                    for week_label, week_archive in weeks_data.items():
                        self.generate_sleep_graph(week_archive, f'Фазы сна (Неделя {week_label})', f'sleep_phases_{week_label}')
                        self.export_sleep_csv(week_archive, f'sleep_data_{week_label}')
                
                if self.steps_archive:
                    weeks_steps_data = {}
                    for dt, steps in self.steps_archive.items():
                        iso_year, iso_week, _ = dt.isocalendar()
                        week_label = f"{iso_year}_W{iso_week:02d}"
                        if week_label not in weeks_steps_data:
                            weeks_steps_data[week_label] = {}
                        weeks_steps_data[week_label][dt] = steps
                        
                    for week_label, week_archive in weeks_steps_data.items():
                        self.generate_steps_graph(week_archive, f'Шаги (Неделя {week_label})', f'steps_{week_label}')
                        
            elif choice == '5':
                raw = await loop.run_in_executor(None, input, "Период автозамера, мин (15/30/45/60) [30]: ")
                try:
                    period = int(raw) if raw.strip() else 30
                except ValueError:
                    period = 30
                if period not in (15, 30, 45, 60):
                    print("❌ Допустимо только 15, 30, 45 или 60. Ставлю 30.")
                    period = 30
                await self.enable_auto_measurement(period)

            elif choice == '6':
                await self.diagnose_spo2()

            elif choice == '4': break

async def main():
    ring = VueloRing()
    print(f"🔍 Ищем Vuelo Ring ({RING_NAME})...")
    device = await BleakScanner.find_device_by_name(RING_NAME, timeout=5.0)
    if not device: return print("❌ Кольцо не найдено.")
    ring.client = BleakClient(device)
    
    try:
        await ring.client.connect()
        print("✅ Успешно подключено!")
        await ring.client.start_notify(NOTIFY_UUID, ring.handle_rx)
        await ring.sync_time()
        if AUTO_MEASURE_ON_CONNECT:
            await ring.enable_auto_measurement(AUTO_MEASURE_PERIOD_MIN, quiet=True)
        await ring.interactive_loop()
    except Exception as e: print(f"⚠️ Ошибка: {e}")
    finally:
        if ring.client and ring.client.is_connected:
            await ring.client.stop_notify(NOTIFY_UUID)
            await ring.client.disconnect()
        print("🔌 Сессия завершена.")

if __name__ == "__main__":
    asyncio.run(main())