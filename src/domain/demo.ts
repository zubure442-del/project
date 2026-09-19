import type { SyncResult } from '../ble/sync';
import type { HeartSample, Sample, SummaryRecord } from '../codec';

/**
 * Выдуманная неделя для показа интерфейса без кольца (в симуляторе BLE не работает).
 * Отдаёт ту же структуру, что и настоящая выгрузка, поэтому проходит через те же расчёты.
 * Числа псевдослучайные, но одинаковые при одном и том же дне — экран не «дёргается».
 */

/** Простой повторяемый генератор: одно и то же зерно даёт один и тот же ряд. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Кольцевая метка полуночи этого дня по «настенному» времени. */
function midnight(now: Date, daysAgo: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000) - new Date().getTimezoneOffset() * 60 - daysAgo * 86400;
}

export interface DemoOptions {
  now?: Date;
  days?: number;
  /** День без SpO2 и без сна — чтобы было видно «недостаточно данных». */
  gapDay?: number;
}

export function buildDemoSync(options: DemoOptions = {}): SyncResult {
  const now = options.now ?? new Date();
  const days = options.days ?? 7;
  const gapDay = options.gapDay ?? 3;
  const minuteOfNow = now.getHours() * 60 + now.getMinutes();

  const steps: Sample[] = [];
  const sleep: Sample[] = [];
  const heart: HeartSample[] = [];
  const spo2: Sample[] = [];
  const summary: SummaryRecord[] = [];

  for (let day = 0; day < days; day++) {
    const base = midnight(now, day);
    const r = rng(1000 + day * 77);
    const today = day === 0;
    /** Сегодня данные есть только до текущего времени. */
    const limit = today ? minuteOfNow : 1440;
    const hasGap = day === gapDay;

    // Сон: засыпание в 23:10–23:50 ПРЕДЫДУЩЕГО дня, подъём утром этого дня.
    if (!hasGap) {
      const bedMinute = 23 * 60 + 10 + Math.floor(r() * 40);
      const bedtime = base - (1440 - bedMinute) * 60;
      const sleepMinutes = 390 + Math.floor(r() * 90);
      for (let i = 0; i < sleepMinutes; i++) {
        const phase = i % 95;
        const deep = phase < 26 && i > 20;
        const awake = r() < 0.012;
        sleep.push({ ts: bedtime + i * 60, value: awake ? 0 : deep ? 85 + Math.floor(r() * 10) : 30 + Math.floor(r() * 40) });
      }
    }

    // Шаги: утро, день, прогулка вечером.
    const activityLevel = hasGap ? 0.35 : 0.7 + r() * 0.6;
    for (let m = 0; m < limit; m++) {
      const hour = m / 60;
      let intensity = 0;
      if (hour >= 8 && hour < 10) intensity = 14;
      else if (hour >= 10 && hour < 13) intensity = 7;
      else if (hour >= 13 && hour < 14) intensity = 22;
      else if (hour >= 14 && hour < 18) intensity = 8;
      else if (hour >= 18 && hour < 20) intensity = 30;
      else if (hour >= 20 && hour < 23) intensity = 5;
      const value = intensity > 0 && r() < 0.55 ? Math.round(intensity * activityLevel * (0.4 + r())) : 0;
      steps.push({ ts: base + m * 60, value });
    }

    // Пульс: автозамер раз в 30 минут, суточный ход + прогулка вечером.
    for (let m = 0; m < limit; m += 30) {
      const hour = m / 60;
      let value = 62 + Math.sin(((hour - 4) / 24) * Math.PI * 2) * 9 + r() * 6;
      if (hour >= 18 && hour < 19.5) value += 42 + r() * 14; // прогулка
      if (hour >= 13 && hour < 13.6) value += 18;
      if (hour < 7) value -= 8;
      const rounded = Math.round(value);
      heart.push({ ts: base + m * 60, value: rounded, raw: [rounded, rounded, rounded, rounded, rounded, rounded] });
    }

    // SpO2: редкие одиночные замеры, только когда рука неподвижна.
    if (!hasGap) {
      for (let m = 0; m < limit; m += 15) {
        const hour = m / 60;
        const still = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 17) || (hour >= 20 && hour < 23);
        if (still && r() < 0.28) spo2.push({ ts: base + m * 60, value: 96 + Math.floor(r() * 4) });
      }
    }

    // Сводка (давление, стресс, глюкоза, HRV) — шаг 15 минут.
    for (let m = 0; m < limit; m += 15) {
      if (r() > 0.45) continue;
      summary.push({
        ts: base + m * 60,
        systolic: 114 + Math.floor(r() * 12),
        diastolic: 72 + Math.floor(r() * 9),
        stress: 24 + Math.floor(r() * 38),
        glucose: Math.round((4.8 + r() * 0.9) * 10) / 10,
        hrv: hasGap ? null : 42 + Math.floor(r() * 28),
      });
    }
  }

  const todaySteps = steps
    .filter((s) => s.ts >= midnight(now, 0))
    .reduce((sum, s) => sum + s.value, 0);

  const sortByTs = <T extends { ts: number }>(a: T[]) => [...a].sort((x, y) => x.ts - y.ts);
  return {
    steps: sortByTs(steps),
    sleep: sortByTs(sleep),
    heart: sortByTs(heart),
    spo2: sortByTs(spo2),
    summary: sortByTs(summary),
    activity: { steps: todaySteps, distanceM: Math.round(todaySteps * 0.72), calories: Math.round(todaySteps * 0.04) },
    battery: 78,
    packetCounts: { steps: 0, sleep: 0, heart: 0, spo2: 0, summary: 0 },
  };
}
