import type { ComponentId, DayScore } from './score';

/** morning — до 11:00 про ночь, day — до 18:00 про текущий день, evening — итог дня. */
export type ReportMode = 'morning' | 'day' | 'evening';

export interface ReportInput {
  mode: ReportMode;
  score: DayScore;
  /** Идентификаторы советов за последние дни, чтобы не повторяться. */
  recentTemplateIds: string[];
}

export interface Report {
  text: string;
  /** Составляющая, на которую сделан упор; null — нет данных или всё хорошо. */
  focus: ComponentId | null;
  templateId: string;
}

/** Точка расширения: позже сюда встанет YandexGPT через свой сервер-посредник. */
export interface ReportGenerator {
  generate(input: ReportInput): Promise<Report>;
}

type Pool = Record<string, string>;

const NO_DATA: Pool = {
  'nodata-1': 'Пока мало данных для вывода. Синхронизируйте кольцо, и картина появится.',
  'nodata-2': 'Данных за этот период недостаточно. Наденьте кольцо и обновите данные.',
};
const GOOD: Record<ReportMode, Pool> = {
  day: {
    'd-good-1': 'Пока всё идёт ровно. Держите привычный ритм.',
    'd-good-2': 'Показатели пока в хорошем диапазоне.',
  },
  morning: {
    'm-good-1': 'Ночь выглядит спокойной. Можно держать привычный ритм.',
    'm-good-2': 'Показатели после ночи в хорошем диапазоне. Хорошее утро для привычных дел.',
    'm-good-3': 'Ночь прошла ровно. Продолжайте в том же режиме.',
  },
  evening: {
    'e-good-1': 'День получился сбалансированным. Хороший вечер, чтобы завершить его без спешки.',
    'e-good-2': 'Составляющие дня держатся на хорошем уровне. Так и продолжайте.',
    'e-good-3': 'Ровный день по всем показателям. Вечер можно провести в своё удовольствие.',
  },
};
/** Советы по самой слабой составляющей. low — ниже 50, mid — 50–75. */
const ADVICE: Record<ReportMode, Partial<Record<ComponentId, { low: Pool; mid: Pool }>>> = {
  // Днём говорим только о том, что происходит сейчас: «пока», без прошедшего времени.
  day: {
    activity: {
      low: {
        'd-act-low-1': 'Движения пока немного. Ещё есть время выйти на прогулку.',
        'd-act-low-2': 'Шагов пока мало. День ещё не закончился.',
      },
      mid: {
        'd-act-mid-1': 'Шаги пока набираются. До привычной отметки ещё немного.',
        'd-act-mid-2': 'Активность пока средняя. Прогулка добавит шагов.',
      },
    },
    sleep: {
      low: {
        'd-sleep-low-1': 'Прошлая ночь была короткой. Сегодня держите темп поспокойнее.',
        'd-sleep-low-2': 'Сна было мало. Не перегружайте остаток дня.',
      },
      mid: {
        'd-sleep-mid-1': 'Сон прошлой ночи средний. Сегодня лучше не затягивать с отбоем.',
        'd-sleep-mid-2': 'Ночью можно было поспать чуть больше. Учтите это к вечеру.',
      },
    },
    state: {
      low: {
        'd-state-low-1': 'Показатели организма пока сдержанные. Выбирайте нагрузку по самочувствию.',
        'd-state-low-2': 'Пока показатели невысокие. Подойдёт спокойный темп.',
      },
      mid: {
        'd-state-mid-1': 'Показатели пока в середине диапазона. Не спешите.',
        'd-state-mid-2': 'Организм пока держится на среднем уровне.',
      },
    },
  },
  morning: {
    sleep: {
      low: {
        'm-sleep-low-1': 'Ночь получилась короткой. Сегодня можно попробовать лечь чуть раньше.',
        'm-sleep-low-2': 'Сна было немного. Вечером подойдёт спокойный режим без поздних экранов.',
        'm-sleep-low-3': 'Ночь вышла короткой. Постарайтесь сегодня освободить время для отдыха.',
      },
      mid: {
        'm-sleep-mid-1': 'Сон был неплохим, но с запасом. Ещё немного времени в постели не помешает.',
        'm-sleep-mid-2': 'Ночь средняя. Попробуйте сегодня ложиться в одно и то же время.',
        'm-sleep-mid-3': 'Сна почти хватило. Ровный режим вечера может помочь ночи.',
      },
    },
    state: {
      low: {
        'm-state-low-1': 'Показатели организма утром сдержанные. Сегодня разумно взять день помягче.',
        'm-state-low-2': 'Утренние показатели невысокие. Можно начать день спокойно и следить за самочувствием.',
        'm-state-low-3': 'Состояние по данным кольца невысокое. Подойдёт умеренная нагрузка.',
      },
      mid: {
        'm-state-mid-1': 'Показатели организма в середине диапазона. Начните день без спешки.',
        'm-state-mid-2': 'Состояние среднее. Лёгкая прогулка утром может быть приятным началом дня.',
        'm-state-mid-3': 'Утренние показатели средние. Держите нагрузку по самочувствию.',
      },
    },
  },
  evening: {
    activity: {
      low: {
        'e-act-low-1': 'Сегодня было мало движения. Небольшая вечерняя прогулка добавит шагов.',
        'e-act-low-2': 'Шагов немного. Пара спокойных кругов до вечера выровняет день.',
        'e-act-low-3': 'День вышел малоподвижным. Завтра можно заложить время на прогулку заранее.',
      },
      mid: {
        'e-act-mid-1': 'Активность на среднем уровне. Короткая прогулка добавит ещё шагов.',
        'e-act-mid-2': 'До хорошей отметки по шагам немного не хватило. Вечерняя прогулка подойдёт.',
        'e-act-mid-3': 'Движения было достаточно для середины диапазона. Завтра можно чуть добавить.',
      },
    },
    sleep: {
      low: {
        'e-sleep-low-1': 'Прошлая ночь была короткой. Сегодня стоит лечь пораньше.',
        'e-sleep-low-2': 'Сна за последнюю ночь было мало. Вечером лучше снизить темп.',
        'e-sleep-low-3': 'Ночь вышла короткой. Подготовьтесь ко сну заранее.',
      },
      mid: {
        'e-sleep-mid-1': 'Сон прошлой ночи средний. Спокойный вечер поможет лечь вовремя.',
        'e-sleep-mid-2': 'Ночью можно было поспать чуть больше. Сегодня попробуйте лечь в привычное время.',
        'e-sleep-mid-3': 'Сон был средним. Уберите экраны за час до сна.',
      },
    },
    state: {
      low: {
        'e-state-low-1': 'Показатели организма сегодня сдержанные. Вечером выберите спокойные занятия.',
        'e-state-low-2': 'Состояние по данным невысокое. Дайте себе тихий вечер.',
        'e-state-low-3': 'Показатели невысокие. Сегодня подойдёт лёгкий режим.',
      },
      mid: {
        'e-state-mid-1': 'Состояние среднее. Вечером подойдёт лёгкая растяжка или чтение.',
        'e-state-mid-2': 'Показатели в середине диапазона. Не перегружайте вечер.',
        'e-state-mid-3': 'Организм держится на среднем уровне. Поужинайте пораньше и не спешите.',
      },
    },
  },
};

/** Все шаблоны — для проверки и подсчёта. */
export function allTemplates(): Pool {
  const out: Pool = { ...NO_DATA, ...GOOD.morning, ...GOOD.day, ...GOOD.evening };
  for (const mode of ['morning', 'day', 'evening'] as const) {
    for (const c of Object.values(ADVICE[mode])) Object.assign(out, c?.low, c?.mid);
  }
  return out;
}

function pick(pool: Pool, recent: string[]): [string, string] {
  const entries = Object.entries(pool);
  return entries.find(([id]) => !recent.includes(id)) ?? entries[0];
}

/** Утром смотрим на ночь (сон и состояние), вечером — на день (активность, состояние, сон). */
export function buildTemplateReport(input: ReportInput): Report {
  const { mode, score, recentTemplateIds } = input;
  const candidates = (mode === 'morning' ? ['sleep', 'state'] : ['activity', 'state', 'sleep']) as ComponentId[];
  const scored = candidates.filter((c) => score[c].score !== null);
  if (!scored.length) {
    const [templateId, text] = pick(NO_DATA, recentTemplateIds);
    return { text, focus: null, templateId };
  }
  const weakest = scored.reduce((a, b) => ((score[b].score as number) < (score[a].score as number) ? b : a));
  const value = score[weakest].score as number;
  const advice = ADVICE[mode][weakest];
  if (value > 75 || !advice) {
    const [templateId, text] = pick(GOOD[mode], recentTemplateIds);
    return { text, focus: null, templateId };
  }
  const [templateId, text] = pick(value < 50 ? advice.low : advice.mid, recentTemplateIds);
  return { text, focus: weakest, templateId };
}

export const templateReportGenerator: ReportGenerator = {
  generate: async (input) => buildTemplateReport(input),
};
