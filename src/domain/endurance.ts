import { NOT_MEDICAL_DEVICE } from './texts';

/**
 * «Пик выносливости» — лучшее время для тренировки в текущем цикле бодрствования.
 * Шесть шагов (задание владельца 25.09.2026):
 * 1. База: подъём + 10 часов, окно ±1 час.
 * 2. Сон: K_sleep < 0.8 — окно на 1.5 часа раньше, интенсивность −20 %.
 * 3. Вегетатика: вариабельность на 15 %+ ниже своей нормы И ночной пульс на 5+ выше — окно 45 минут,
 *    нагрузка не выше 50 %.
 * 4. Критические замеры (держатся полчаса–час, а не один выброс кольца): кислород ночью ниже 95,
 *    давление днём выше 140/90 или ниже 100/60, глюкоза ниже 4.0 — только восстановительная
 *    тренировка в самое спокойное (по стрессу) время.
 * 5. Еда неприкосновенна: от начала приёма −45 минут до конца +120 минут тренировки нет.
 *    Окно сдвигается или урезается в свободный промежуток, лучше — после обеда, перед ужином.
 * 6. Итог: окно, интенсивность 0–100 % и причины сдвига. Формулы и замеры пользователю не показываем.
 * Все времена — минуты от полуночи даты начала цикла (после полуночи — больше 1440).
 */

/** Шаг 1: пик — через столько часов после подъёма, окно — плюс-минус час. */
export const ENDURANCE_PEAK_AFTER_WAKE_MIN = 10 * 60;
export const ENDURANCE_HALF_WINDOW_MIN = 60;
/** Шаг 2. */
export const K_SLEEP_LOW = 0.8;
export const SLEEP_SHIFT_EARLIER_MIN = 90;
export const SLEEP_INTENSITY_FACTOR = 0.8;
/** Шаг 3. */
export const HRV_DROP_SHARE = 0.15;
export const NIGHT_PULSE_RISE_BPM = 5;
export const OVERTRAINING_WINDOW_MIN = 45;
export const OVERTRAINING_INTENSITY = 50;
/** Шаг 4: пороги. */
export const SPO2_CRITICAL = 95;
export const BP_HIGH = { systolic: 140, diastolic: 90 } as const;
export const BP_LOW = { systolic: 100, diastolic: 60 } as const;
export const GLUCOSE_LOW = 4.0;
/**
 * Шаг 4: замер считается, только если держится — столько замеров подряд, каждый следующий
 * не дальше CRITICAL_MAX_GAP_MIN от предыдущего. Кольцо мерит раз в 30 минут: два подряд — полчаса–час.
 */
export const CRITICAL_MIN_READINGS = 2;
export const CRITICAL_MAX_GAP_MIN = 60;
/** Восстановительная тренировка: лёгкая нагрузка. */
export const RECOVERY_INTENSITY = 30;
/** Шаг 5: запретные зоны вокруг еды. */
export const MEAL_BUFFER_BEFORE_MIN = 45;
export const MEAL_BUFFER_AFTER_MIN = 120;
/** Урезанное окно короче этого не предлагаем; шаг сдвига окна. */
export const ENDURANCE_MIN_WINDOW_MIN = 30;
export const ENDURANCE_STEP_MIN = 15;

/** Почему окно сдвинулось или нагрузка ниже. Интерфейс переводит в понятный текст. */
export type EnduranceFlag = 'sleep' | 'overtraining' | 'biomarkers' | 'food';

export interface Reading {
  m: number;
  v: number;
}

export interface EnduranceInput {
  /** Подъём (конец сна цикла). */
  wakeMinute: number;
  /** Обычный отход ко сну: окно не выходит за конец цикла. */
  bedtimeMinute: number;
  /** Шаг 2: глубокий и лёгкий сон этой ночи и свои нормы (null — истории нет, шаг пропускается). */
  deepMin: number;
  lightMin: number;
  deepNorm: number | null;
  lightNorm: number | null;
  /** Шаг 3: вариабельность и средний пульс этой ночи и свои нормы. */
  nightHrv: number | null;
  hrvNorm: number | null;
  nightPulse: number | null;
  pulseNorm: number | null;
  /** Шаг 4: кислород за ночь, давление за день, глюкоза за цикл — по времени. */
  nightSpo2: readonly Reading[];
  dayPressure: readonly { m: number; systolic: number; diastolic: number }[];
  glucose: readonly Reading[];
  /** Прогноз стресса по часам суток (0–23): среднее бодрствующих замеров; null — не знаем. */
  stressByHour: readonly (number | null)[];
  /** Шаг 5: приёмы пищи по расписанию «Цикла питания». */
  meals: readonly { from: number; to: number }[];
}

export interface EnduranceResult {
  from: number;
  to: number;
  /** Рекомендуемая интенсивность, 0–100 %. */
  intensity: number;
  kind: 'training' | 'recovery';
  flags: EnduranceFlag[];
}

interface Span {
  from: number;
  to: number;
}

/**
 * Коэффициент сна. Быстрого сна кольцо не отдаёт: у колец без него быстрый сон попадает в лёгкий,
 * поэтому вместо «быстрый / норма быстрого» берём «лёгкий / норма лёгкого» и усредняем с глубоким.
 */
export function sleepReadiness(input: Pick<EnduranceInput, 'deepMin' | 'lightMin' | 'deepNorm' | 'lightNorm'>): number | null {
  const parts = [
    input.deepNorm ? input.deepMin / input.deepNorm : null,
    input.lightNorm ? input.lightMin / input.lightNorm : null,
  ].filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

/** Шаг 3: вариабельность упала на 15 %+ и ночной пульс вырос на 5+ одновременно. */
export function overtrained(input: Pick<EnduranceInput, 'nightHrv' | 'hrvNorm' | 'nightPulse' | 'pulseNorm'>): boolean {
  const { nightHrv, hrvNorm, nightPulse, pulseNorm } = input;
  if (nightHrv === null || hrvNorm === null || nightPulse === null || pulseNorm === null || hrvNorm <= 0) return false;
  return nightHrv <= hrvNorm * (1 - HRV_DROP_SHARE) && nightPulse >= pulseNorm + NIGHT_PULSE_RISE_BPM;
}

/** Замер держится: CRITICAL_MIN_READINGS подряд за порогом, без больших пауз между ними. */
export function sustained<T extends { m: number }>(readings: readonly T[], beyond: (r: T) => boolean): boolean {
  const sorted = [...readings].sort((a, b) => a.m - b.m);
  let run = 0;
  let last: number | null = null;
  for (const r of sorted) {
    const continues = last !== null && r.m - last <= CRITICAL_MAX_GAP_MIN;
    run = beyond(r) ? (continues && run > 0 ? run + 1 : 1) : 0;
    if (run >= CRITICAL_MIN_READINGS) return true;
    last = r.m;
  }
  return false;
}

/** Шаг 4: какие критические замеры держатся. */
export function criticalMarkers(input: Pick<EnduranceInput, 'nightSpo2' | 'dayPressure' | 'glucose'>): boolean {
  const spo2 = sustained(input.nightSpo2, (r) => r.v < SPO2_CRITICAL);
  const pressure = sustained(
    input.dayPressure,
    (r) =>
      r.systolic > BP_HIGH.systolic || r.diastolic > BP_HIGH.diastolic || r.systolic < BP_LOW.systolic || r.diastolic < BP_LOW.diastolic,
  );
  const glucose = sustained(input.glucose, (r) => r.v < GLUCOSE_LOW);
  return spo2 || pressure || glucose;
}

const hourOf = (m: number) => ((Math.floor(m / 60) % 24) + 24) % 24;

/** Средний прогноз стресса на отрезке; null — ни одного известного часа. */
function stressOver(span: Span, byHour: readonly (number | null)[]): number | null {
  const values: number[] = [];
  for (let m = span.from; m < span.to; m += ENDURANCE_STEP_MIN) {
    const v = byHour[hourOf(m)];
    if (v !== null && v !== undefined) values.push(v);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Окно той же длины в самое спокойное время цикла; прогноза нет — окно остаётся. */
function calmestWindow(window: Span, range: Span, byHour: readonly (number | null)[]): Span {
  const length = window.to - window.from;
  let best = window;
  let bestStress = stressOver(window, byHour);
  for (let from = range.from; from + length <= range.to; from += ENDURANCE_STEP_MIN) {
    const candidate = { from, to: from + length };
    const stress = stressOver(candidate, byHour);
    if (stress !== null && (bestStress === null || stress < bestStress)) {
      best = candidate;
      bestStress = stress;
    }
  }
  return best;
}

/** Свободные промежутки отрезка `range` за вычетом запретных зон. */
function freeIntervals(range: Span, blocked: readonly Span[]): Span[] {
  const sorted = [...blocked].sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  let cursor = range.from;
  for (const b of sorted) {
    if (b.to <= cursor) continue;
    if (b.from >= range.to) break;
    if (b.from > cursor) out.push({ from: cursor, to: Math.min(b.from, range.to) });
    cursor = Math.max(cursor, b.to);
  }
  if (cursor < range.to) out.push({ from: cursor, to: range.to });
  return out;
}

/** Окно длиной до `length` внутри промежутка — как можно ближе к центру `center`. */
function fitInto(gap: Span, length: number, center: number): Span | null {
  const len = Math.min(length, gap.to - gap.from);
  if (len < ENDURANCE_MIN_WINDOW_MIN) return null;
  const from = Math.min(Math.max(center - len / 2, gap.from), gap.to - len);
  return { from, to: from + len };
}

/**
 * Шаг 5: окно не пересекает еду. Если пересекает — ставим в свободный промежуток:
 * сначала после обеда и перед ужином (при двух приёмах — после первого и до последнего),
 * иначе — в ближайший к исходному времени. Промежуток короче окна — окно урезается,
 * но не короче ENDURANCE_MIN_WINDOW_MIN.
 */
export function avoidMeals(window: Span, range: Span, meals: readonly Span[]): { window: Span; moved: boolean } {
  const blocked = meals.map((m) => ({ from: m.from - MEAL_BUFFER_BEFORE_MIN, to: m.to + MEAL_BUFFER_AFTER_MIN }));
  if (!blocked.some((b) => b.from < window.to && b.to > window.from)) return { window, moved: false };
  const free = freeIntervals(range, blocked);
  const center = (window.from + window.to) / 2;
  const length = window.to - window.from;
  const sortedMeals = [...blocked].sort((a, b) => a.from - b.from);
  // «После обеда, перед ужином»: между предпоследним и последним приёмом.
  const preferred =
    sortedMeals.length >= 2
      ? { from: sortedMeals[sortedMeals.length - 2].to, to: sortedMeals[sortedMeals.length - 1].from }
      : null;
  const inPreferred = preferred
    ? free.filter((f) => f.from >= preferred.from && f.to <= preferred.to).map((f) => fitInto(f, length, center))
    : [];
  const pick = (options: (Span | null)[]) =>
    options
      .filter((o): o is Span => o !== null)
      .sort((a, b) => Math.abs((a.from + a.to) / 2 - center) - Math.abs((b.from + b.to) / 2 - center))[0] ?? null;
  const chosen = pick(inPreferred) ?? pick(free.map((f) => fitInto(f, length, center)));
  if (chosen) return { window: chosen, moved: true };
  // Совсем тесно: самый длинный свободный промежуток, даже если он короче минимума.
  const longest = [...free].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  return longest ? { window: { from: longest.from, to: Math.min(longest.to, longest.from + length) }, moved: true } : { window, moved: false };
}

/** Окно внутри отрезка цикла: сдвигаем целиком, если вылезло за край. */
function clampInto(window: Span, range: Span): Span {
  const length = Math.min(window.to - window.from, range.to - range.from);
  const from = Math.min(Math.max(window.from, range.from), range.to - length);
  return { from, to: from + length };
}

const round5 = (m: number) => Math.round(m / 5) * 5;

export function endurancePeak(input: EnduranceInput): EnduranceResult {
  const range = { from: input.wakeMinute, to: Math.max(input.bedtimeMinute, input.wakeMinute + 2 * ENDURANCE_HALF_WINDOW_MIN) };
  const flags: EnduranceFlag[] = [];
  let intensity = 100;
  let kind: EnduranceResult['kind'] = 'training';

  // Шаг 1.
  const center = input.wakeMinute + ENDURANCE_PEAK_AFTER_WAKE_MIN;
  let window: Span = { from: center - ENDURANCE_HALF_WINDOW_MIN, to: center + ENDURANCE_HALF_WINDOW_MIN };

  // Шаг 2.
  const kSleep = sleepReadiness(input);
  if (kSleep !== null && kSleep < K_SLEEP_LOW) {
    window = { from: window.from - SLEEP_SHIFT_EARLIER_MIN, to: window.to - SLEEP_SHIFT_EARLIER_MIN };
    intensity *= SLEEP_INTENSITY_FACTOR;
    flags.push('sleep');
  }

  // Шаг 3.
  if (overtrained(input)) {
    const mid = (window.from + window.to) / 2;
    window = { from: mid - OVERTRAINING_WINDOW_MIN / 2, to: mid + OVERTRAINING_WINDOW_MIN / 2 };
    intensity = Math.min(intensity, OVERTRAINING_INTENSITY);
    flags.push('overtraining');
  }
  window = clampInto(window, range);

  // Шаг 4.
  if (criticalMarkers(input)) {
    kind = 'recovery';
    intensity = Math.min(intensity, RECOVERY_INTENSITY);
    window = calmestWindow(window, range, input.stressByHour);
    flags.push('biomarkers');
  }

  // Шаг 5.
  const fed = avoidMeals(window, range, input.meals);
  window = fed.window;
  if (fed.moved) flags.push('food');

  // Шаг 6.
  return { from: round5(window.from), to: round5(window.to), intensity: Math.round(intensity), kind, flags };
}

/** «i» в шапке карточки: что это за окно, простыми словами, без формул и чисел. */
export const ENDURANCE_INFO = {
  title: 'Что показывает пик',
  text:
    'Это время дня, когда тренировка, скорее всего, дастся легче всего. Мы считаем его от вашего ' +
    'пробуждения, а потом поправляем по тому, как прошла ночь и как организм восстановился. ' +
    'Если что-то в замерах кольца говорит, что сегодня лучше поберечься, предложим лёгкую ' +
    'восстановительную нагрузку в самое спокойное время.\n\n' +
    'Время подобрано так, чтобы тренировка не приходилась на еду и на пару часов после неё. ' +
    'Интенсивность — от вашей обычной полной нагрузки. ' + NOT_MEDICAL_DEVICE,
} as const;

/** Причины сдвига простыми словами, без показателей и формул (владелец: расчёты — внутри приложения). */
export const ENDURANCE_FLAG_TEXT: Record<EnduranceFlag, string> = {
  sleep: 'Сон был короче обычного — пик раньше, нагрузка легче.',
  overtraining: 'Организм ещё восстанавливается — окно короче, нагрузка вполовину.',
  biomarkers: 'Сегодня лучше восстановительная тренировка в самое спокойное время.',
  food: 'Время подобрано так, чтобы не мешать еде.',
};
