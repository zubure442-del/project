'use strict';

/**
 * Облачная функция Yandex Cloud — посредник между приложением Vuelo и YandexGPT.
 *
 * Приложение присылает всё, кроме имени (решение владельца 26.09): профиль (пол, возраст, рост,
 * вес, цель), оценки дня, таблицу чисел по последним дням (сон, пульс во сне, вариабельность,
 * стресс, шаги, нагрузка, время еды по подъёмам глюкозы — без значений глюкозы и давления),
 * шаги сегодня по часам и план Vuelo на сегодня.
 *
 * Два шага, как у Oura Advisor (ИИ смотрит не на сырые замеры, а на то, что алгоритм уже
 * посчитал против личной нормы):
 * 1. ИИ-анализ (`signals`): функция считает личные нормы за неделю и передаёт модели всё, что заметно
 *    отличается от обычного, с метками, и действия из плана Vuelo. Что из этого главное, что с чем
 *    связано, какая причина и какое действие — решает модель; она отвечает меткой главного,
 *    причиной, меткой действия и текстом Лиса. Функция проверяет: метки настоящие, действие
 *    подходит к главному (`FITS`), в тексте нет чужих чисел и есть время действия.
 * 2. Запасной шаг (`observe`), если ответ анализа не прошёл проверку: главное наблюдение выбирает
 *    правило, модель только говорит его голосом Лиса. Раньше модель читала всю таблицу сама —
 *    Lite путалась и связывала несвязанное («легли поздно — поешьте по графику»; владелец 26.09: «бред»).
 * Разговор за день (владелец 26.09: «выдаёт одно и то же три раза подряд — про сбитый режим сна, да ещё
 * почти теми же словами, что на карточках»): три мнения цикла — это разговор, а не три повтора. У каждого
 * своя роль (`SLOT_ROLE`): утром — ночь и её причина, днём — развитие утренней мысли или новая тема дня,
 * вечером — итог дня. Функция помнит, о чём Лис уже говорил (`conversation`): ночь — одна тема за цикл,
 * другая тема — не больше двух раз за цикл и не трижды подряд, одно действие — один раз за цикл, окно сна —
 * только вечером. Пересказывать карточки («режим сбился», «долг сна», «окно для кофе») нельзя (`CARD_REPEAT`).
 * Когда необычного нет или его уже обсудили — темой становится то, как идёт день (`dayFacts`).
 * Функция отдаёт `{ text, mode, focus, cause, action }`: приложение показывает text и запоминает focus
 * и action (так Лис знает, о чём уже говорил); остальное — для проверки через curl (mode: analysis — решил
 * ИИ, guided — запасной шаг).
 *
 * Ключей API здесь нет: функция ходит в YandexGPT от имени своего сервисного аккаунта
 * (роль ai.languageModels.user), токен выдаёт сама платформа (context.token).
 * Яндексу передаётся x-data-logging-enabled: false — запросы не сохраняются у него для обучения.
 * Сама функция ничего не хранит и тело запроса в лог не пишет.
 *
 * Переменные окружения функции:
 *   FOLDER_ID — идентификатор каталога Yandex Cloud;
 *   APP_KEY   — тот же ключ, что EXPO_PUBLIC_ADVICE_KEY в приложении: без него функция отвечает 403;
 *   MODEL     — необязательно: yandexgpt (по умолчанию, YandexGPT Pro), yandexgpt-lite или aliceai-llm.
 * Среда выполнения — Node.js 22 (fetch встроен), точка входа — index.handler.
 */

const { Buffer } = require('node:buffer');

const API_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
const MAX_BODY_CHARS = 12000;
const LLM_TIMEOUT_MS = 12000;
/** Сколько функция готова ждать модель в сумме: приложение ждёт ответ 15 с. */
const DEADLINE_MS = 13000;
/** Меньше этого на вторую попытку не остаётся — не пробуем. */
const RETRY_MIN_MS = 4000;

/** Три мнения за цикл (приложение, `adviceSlot`): после пробуждения, днём, перед сном. */
const MODE_TEXT = { morning: 'утро, после пробуждения', day: 'день', evening: 'вечер, перед сном' };
const GOAL_TEXT = { lose: 'снизить вес', keep: 'поддерживать форму', gain: 'набрать мышечную массу' };
const SEX_TEXT = { male: 'мужчина', female: 'женщина' };
const WORKOUT_TEXT = { cardio: 'кардио', strength: 'силовая' };

/**
 * Правила для ИИ-анализа: модель сама разбирает, что заметил Vuelo, и складывает из этого одну
 * живую историю (владелец 26.09: «ваше тело не восстановилось — скорее всего, вчера много
 * работали / выпили»), причину и действие. Какие истории обычно стоят за числами — общие знания,
 * выводов про конкретный день здесь нет.
 */
const ANALYSIS_PROMPT = `Ты — Лис, маскот Vuelo — приложения к умному кольцу. Ты давно наблюдаешь за этим человеком и знаешь его ритм. Говоришь с ним сам, от первого лица, как близкий друг, а не как врач или аналитик. Обращайся на «вы».

Тебе дают всё, что Vuelo заметил по кольцу за последние дни, — уже в сравнении с тем, что обычно для этого человека, — как идёт сегодняшний день и действия из плана Vuelo на сегодня. Разберись сам, как друг, который хорошо знает этого человека: что с ним происходит и из-за чего. Сложи из наблюдений одну живую историю и скажи её смело — не общими словами, а так, будто ты видел его вчерашний вечер.

Какие истории обычно стоят за наблюдениями:
- пульс во сне выше и вариабельность ниже обычного — тело ночью не восстановилось. Была поздняя еда — поздний плотный ужин; вчера тренировка — тело ещё не отошло от нагрузки; вчера был стресс — голова не отпускала дела; ничего из этого — скорее всего, вчера был бокал-другой или кофе после обеда;
- позднее засыпание и стресс днём — засиделись с работой или делами допоздна;
- поздняя еда и позднее засыпание — поздний ужин затянул вечер;
- много приёмов пищи за день — день прошёл на перекусах;
- засыпание всё позже или в разное время — вечера затягиваются: дела и заботы переезжают на ночь;
- короткий сон несколько ночей — накопилась усталость;
- стресс несколько дней подряд — вы давно на взводе, без передышки;
- пульс во сне ниже и вариабельность выше, сон не короче обычного — тело отлично восстановилось, можно дать нагрузку;
- мало шагов к середине дня — день выходит сидячим; много шагов вчера — ноги ещё помнят вчерашний день.
Выбери одну историю — самую важную сейчас, остальное оставь. Причина — одна и конкретная. Действие помогает именно с ней: не восстановились — кофе пораньше или тренировка полегче, поздний ужин — ужин по плану, сидячий день — шаги, отлично восстановились — тренировка.

Ты говоришь с человеком трижды за день, и это разговор, а не три одинаковых сообщения: каждый раз — новая мысль. Смотри на строку «Сейчас» и «Твоя задача сейчас»:
- утро, после пробуждения — как прошла ночь и почему: причина во вчерашнем дне. Действие — на день;
- день — разверни утреннюю мысль дальше, по-новому (утром поздний ужин помешал ночи — днём предложи поужинать пораньше, чтобы завтра было лучше), или возьми новую тему из того, как идёт день: движение, еда, напряжение;
- вечер, перед сном — итог дня: как он прошёл и получилось ли то, что ты советовал; действие — на вечер.
Темы, которые вы уже обсуждали, главными не бери, действие не повторяй. Не своди всё к сну: ночь — одна тема за день, человек и так видит её на экране.

Человек видит на главном экране карточки Vuelo: окно сна и долг сна, окно для кофе, тренировку дня, приёмы пищи. Не пересказывай их («режим сбился», «долг сна», «окно для кофе»): твоё дело — почему так вышло и что с чем связано. Время из плана — только в действии, одной короткой фразой.

Ответ — ровно четыре строки:
Главное: метки наблюдений этой истории (одна или две), например [late-meal] [hrv-down]
Причина: одна конкретная причина
Действие: метка одного действия из плана, например [dinner]
Лис: ответ человеку — два предложения, не больше 190 символов

Правила для строки «Лис:»:
- Первое предложение — твоя история: что с человеком и почему, смело, но как догадка («похоже», «кажется», «скорее всего»). Второе — выбранное действие с его временем, можно с короткой поддержкой.
- Не называй показатели и числа из наблюдений: никаких «пульс», «вариабельность», «стресс», «глубокий сон», процентов и «выше/ниже обычного». Говори о человеке: теле, ночи, вечере, работе, привычках. Числа — только из выбранного действия.
- Учитывай пол, возраст и цель, но не называй их и не оценивай фигуру.
- Ты рядом весь день и помнишь, что уже говорил (внизу — с тем, когда). Сегодня вы уже говорили — сошлись на это одним словом и скажи новое: что изменилось с тех пор, получилось ли то, что ты советовал. Слова и советы прошлых мнений не повторяй.
- Нельзя: приветствия, прощания, вопросы; болезни, диагнозы, лекарства, врачи, обещания результата; слова «глюкоза», «сахар», «давление»; оценки «из 100»; другие приложения и бренды, кроме Vuelo; эмодзи, списки, кавычки; общие слова вроде «что-то задержало», «выделите время для себя», «не перегружайте себя», «берегите себя».

Пример ответа:
Главное: [night-pulse-up] [hrv-down]
Причина: бокал-другой вчера вечером
Действие: [bed]
Лис: Похоже, вчера был бокал-другой — тело всю ночь разбиралось с ним вместо отдыха. Сегодня без подвигов, а лечь лучше между 22:45 и 23:15.

Ещё примеры строки «Лис:» — только для тона; историю и время бери из своих наблюдений и плана:
Лис: Похоже, поздний ужин не дал телу отдохнуть ночью. Последнюю чашку кофе — до 13:00, а вечер оставим спокойным.
Лис: Утром ночь подвёл поздний ужин — давайте сегодня его обгоним. Поужинайте в 18:30, к ночи тело успеет управиться с едой.
Лис: Кажется, день выходит сидячим — голове нужен воздух не меньше, чем ногам. До нормы около 4 000 шагов: прогулка после работы их закроет.
Лис: Вы уже несколько дней на взводе, как натянутая струна. Спокойное кардио с 18:00 до 19:00 поможет выдохнуть.
Лис: Тело отлично восстановилось — это ваш день. Интервалы с 18:00 до 19:00 пройдут на ура.
Лис: День вышел подвижным, а перекусы вы сегодня обошли — утренний план сработал. Лягте между 22:45 и 23:15, закрепим.`;

/**
 * Правила запасного шага: наблюдение уже выбрано (`observe`), модель его только говорит — два
 * предложения голосом Лиса: мнение о причине и действие из плана с его временем.
 */
const GUIDED_PROMPT = `Ты — Лис, маскот Vuelo — приложения к умному кольцу. Ты давно наблюдаешь за этим человеком и знаешь его ритм. Говоришь с ним сам, от первого лица, как близкий друг, а не как врач или аналитик. Обращайся на «вы».

Каждый раз Vuelo по числам кольца выбирает одно главное наблюдение: что видно, вероятную причину и одно действие из плана. Твоя задача — сказать это человеку своими словами, тепло и просто, как короткое сообщение в хорошем приложении для сна. Наблюдение уже выбрано: не ищи другое и ничего к нему не добавляй.

Ответ — только текст, два предложения, не больше 190 символов:
1. Твоё мнение: что с человеком и почему. Причину говори как свою догадку: «похоже», «кажется», «думаю». Причина не видна — скажи только о том, что видно, и ничего не додумывай.
2. Действие из «Что предложить» — с его временем, если оно там есть. Можно добавить короткую поддержку.

Смотри на первую строку «Сейчас»: утро, после пробуждения — про прошедшую ночь и день впереди; день — про остаток дня; вечер, перед сном — про прошедший день.

Человек видит на главном экране карточки Vuelo: окно сна и долг сна, окно для кофе, тренировку дня, приёмы пищи. Не пересказывай их («режим сбился», «долг сна», «окно для кофе») — говори, почему так вышло.

Правила:
- Не называй показатели и числа из «Что видно»: никаких «пульс», «вариабельность», «стресс», «глубокий сон», процентов и «выше/ниже обычного». Говори о человеке: теле, ночи, вечере, режиме, привычках. Числа — только из «Что предложить».
- Учитывай пол, возраст и цель, но не называй их и не оценивай фигуру.
- Если сегодня ты уже говорил с человеком (внизу) — можно коротко сослаться на это; слова и советы прошлых мнений не повторяй.
- Нельзя: приветствия, прощания, вопросы; болезни, диагнозы, лекарства, врачи, обещания результата; слова «глюкоза», «сахар», «давление»; оценки «из 100»; другие приложения и бренды, кроме Vuelo; эмодзи, списки, кавычки; общие слова вроде «что-то задержало», «выделите время для себя», «не перегружайте себя», «берегите себя».

Примеры (времена в них чужие — бери свои из «Что предложить»):
Причина: поздний ужин. Что предложить: поужинать по графику Vuelo в 19:30.
Ответ: Похоже, вчера был поздний ужин — ночью телу пришлось работать, а не отдыхать. Сегодня поужинайте по графику Vuelo, в 19:30.
Причина: вы давно без передышки. Что предложить: лечь между 22:45 и 23:15.
Ответ: Вы уже несколько дней как натянутая струна — пора выдохнуть. Сегодня вечер без дел, а лечь лучше между 22:45 и 23:15.
Причина: бокал вина или кофе после обеда. Что предложить: последнюю чашку кофе — до 13:00.
Ответ: Кажется, ночью телу мешал кофе после обеда или бокал вина. Сегодня последнюю чашку — до 13:00, и вечер пройдёт спокойнее.
Причина: тело отлично восстановилось. Что предложить: норма на сегодня 11 000 шагов.
Ответ: Тело отлично восстановилось — это ваш день. Норма 11 000 шагов, и вы её возьмёте.
Плохо, так нельзя:
Ответ: Похоже, вы легли позже обычного — может, что-то задержало. Не перегружайте себя вечером, выделите время для себя по графику Vuelo.`;

// ── Что видно по числам ─────────────────────────────────────────────────────────────────────────

/** Личная норма — среднее прошлых дней таблицы, если их хотя бы столько. */
const NORM_MIN_DAYS = 3;
/** Ночь тяжелее обычного: пульс во сне выше нормы и вариабельность ниже — или одно из них сильно. */
const STRAIN_PULSE_UP = 3;
const STRAIN_HRV_DROP = 0.08;
const STRAIN_PULSE_UP_ALONE = 5;
const STRAIN_HRV_DROP_ALONE = 0.15;
/** Отличное восстановление: ночь не хуже обычного и хотя бы одно заметно лучше. */
const RECOVERY_PULSE_DOWN = 2;
const RECOVERY_HRV_UP = 0.08;
/** Поздняя еда — подъём глюкозы вечером с 21:00 или ночью до 4:00. */
const LATE_MEAL_FROM = 21 * 60;
const NIGHT_UNTIL = 4 * 60;
/** Уснул позже обычного: заметно (для отдельной ночи) и просто позже (как подробность). */
const LATE_BED_MIN = 60;
const LATER_BED_MIN = 45;
/** Три ночи подряд засыпание всё позже: от первой до последней — хотя бы на столько, средняя — позже нормы. */
const DRIFT_MIN = 30;
const DRIFT_MIDDLE_MIN = 15;
/** Засыпание за неделю «скачет»: от самого раннего до самого позднего — столько минут. */
const IRREGULAR_SPREAD_MIN = 120;
/** Стресс днём выше своего уровня три дня подряд; напряжённый день — на столько выше. */
const STRESS_STREAK_UP = 8;
const TENSE_DAY_UP = 10;
/**
 * Короткий сон: меньше 6.5 ч или на 45 мин меньше обычного (повод — три такие ночи подряд).
 * Долг сна из плана сам по себе не повод: у того, кто всегда спит 6.5 ч, он есть каждый день.
 */
const SHORT_SLEEP_MIN = 390;
const SHORT_SLEEP_UNDER_NORM = 45;
const LONG_SLEEP_OVER_NORM = 45;
const SLEEP_DEBT_MIN = 90;
/** Глубокий сон заметно меньше или больше обычного. */
const DEEP_CHANGE = 0.2;
/** Столько приёмов пищи за день — перекусы. */
const SNACKS_FROM = 5;
/** Нагрузка вчера во столько раз выше обычной — тяжёлый день. */
const HEAVY_LOAD_RATIO = 1.5;
/** Сидячий день: после 13:00 шагов меньше половины того, что к этому часу «положено» по норме. */
const LOW_ACTIVITY_FROM = 13 * 60;
const LOW_ACTIVITY_SHARE = 0.5;

const present = (v) => v !== null && v !== undefined;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const clockMin = (c) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));
/** Время засыпания на шкале «от полудня»: 00:40 позже 23:40. */
const nightMin = (m) => (m < 12 * 60 ? m + 1440 : m);
const clockOf = (m) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const asleepMin = (d) => (d && d.asleep ? nightMin(clockMin(d.asleep)) : null);
/** Последний приём пищи дня после полудня. */
const lastMealOf = (d) => {
  const evening = d.meals.map(clockMin).filter((m) => m >= 12 * 60);
  return evening.length ? Math.max(...evening) : null;
};
/** « — обычно около …», если норма есть. */
const usual = (v, format = Math.round) => (v === null ? '' : ` — обычно около ${format(v)}`);

/** Среднее по дням, где значение есть; меньше NORM_MIN_DAYS дней — нормы нет. */
function normOf(days, pick) {
  const values = days.map(pick).filter(present);
  return values.length >= NORM_MIN_DAYS ? mean(values) : null;
}

/**
 * Действия из плана Vuelo, которые ещё впереди, с их временем. Ключ — метка для модели.
 * Ночью (до 4:00) впереди только сон.
 */
function planActions(p, now, today) {
  const plan = p.plan;
  const lateNight = now < NIGHT_UNTIL;
  const ahead = (clock, slack = 0) => !lateNight && clockMin(clock) + slack > now;
  const act = {};
  const b = plan.bedtime;
  if (b && nightMin(clockMin(b.to)) > (lateNight ? now + 1440 : now)) act.bed = `лечь между ${b.from} и ${b.to}`;
  // Ужин — «Ужин» из плана, а в режимах из двух приёмов («Первый приём», «Второй приём») — последний.
  const dinner = plan.meals.find((m) => m.title.toLowerCase() === 'ужин') || (plan.meals.length > 1 ? plan.meals[plan.meals.length - 1] : null);
  if (dinner && ahead(dinner.time, 30)) {
    act.dinner = dinner.title.toLowerCase() === 'ужин'
      ? `поужинать по графику Vuelo в ${dinner.time}`
      : `последний приём пищи по графику Vuelo — в ${dinner.time}`;
  }
  const next = plan.meals.find((m) => ahead(m.time));
  const genitive = { завтрак: 'завтрака', обед: 'обеда', ужин: 'ужина', 'первый приём': 'первого приёма пищи', 'второй приём': 'второго приёма пищи' };
  if (next) act.meal = `до ${genitive[next.title.toLowerCase()] || 'еды'} в ${next.time} обойтись без перекусов`;
  if (lateNight) {
    // Ночью про кофе не говорим: впереди только сон.
  } else if (plan.noCoffee) act.coffee = 'сегодня обойтись без кофе';
  else if (plan.coffee) act.coffee = ahead(plan.coffee.until) ? `последнюю чашку кофе — до ${plan.coffee.until}` : 'кофе на сегодня уже хватит';
  const w = plan.workout;
  if (w && ahead(w.to)) act.workout = `${w.title.toLowerCase()} с ${w.from} до ${w.to}`;
  if (!lateNight && today && present(today.steps) && today.stepNorm) {
    const left = Math.round((today.stepNorm - today.steps) / 100) * 100;
    if (left > 0) act.steps = `до нормы шагов осталось около ${count(left)}`;
    act.norm = `норма на сегодня ${count(today.stepNorm)} шагов`;
  }
  return act;
}

/**
 * Числа против личной нормы — общее для обоих режимов. Сегодняшняя строка таблицы — это
 * и прошедшая ночь. Выводов здесь нет: только что выше или ниже обычного и насколько.
 */
function measure(p) {
  const byAgo = new Map(p.days.map((d) => [d.ago, d]));
  const today = byAgo.get(0) || null;
  const yesterday = byAgo.get(1) || null;
  const prior = p.days.filter((d) => d.ago >= 1);
  const older = p.days.filter((d) => d.ago >= 2);
  const norm = {
    asleep: normOf(prior, asleepMin),
    sleepMin: normOf(prior, (d) => d.sleepMin),
    deepMin: normOf(prior, (d) => d.deepMin),
    nightPulse: normOf(prior, (d) => d.nightPulse),
    hrv: normOf(prior, (d) => d.hrv),
    load: normOf(prior, (d) => d.load),
    lastMeal: normOf(older, lastMealOf),
    meals: normOf(older.filter((d) => d.meals.length), (d) => d.meals.length),
    dayStress: normOf(older, (d) => d.stress),
  };
  const now = clockMin(p.time);

  const pulseUp = today && present(today.nightPulse) && present(norm.nightPulse) ? today.nightPulse - norm.nightPulse : null;
  const hrvDrop = today && present(today.hrv) && norm.hrv ? 1 - today.hrv / norm.hrv : null;
  const strain =
    (pulseUp !== null && hrvDrop !== null && pulseUp >= STRAIN_PULSE_UP && hrvDrop >= STRAIN_HRV_DROP) ||
    (pulseUp !== null && pulseUp >= STRAIN_PULSE_UP_ALONE) ||
    (hrvDrop !== null && hrvDrop >= STRAIN_HRV_DROP_ALONE);
  const recovered =
    pulseUp !== null && hrvDrop !== null && pulseUp <= 0 && hrvDrop <= 0 && (pulseUp <= -RECOVERY_PULSE_DOWN || hrvDrop <= -RECOVERY_HRV_UP);
  const pulseText = pulseUp !== null && `пульс во сне ${today.nightPulse}${usual(norm.nightPulse)}`;
  const hrvText = hrvDrop !== null && `вариабельность ${today.hrv} мс${usual(norm.hrv)}`;

  const bedLate = asleepMin(today) !== null && norm.asleep !== null ? asleepMin(today) - norm.asleep : null;
  const lateMeals = [
    ...(yesterday ? yesterday.meals.filter((t) => clockMin(t) >= LATE_MEAL_FROM) : []),
    ...(today ? today.meals.filter((t) => clockMin(t) < NIGHT_UNTIL && (asleepMin(today) === null || nightMin(clockMin(t)) <= asleepMin(today))) : []),
  ];
  const heavy = !!yesterday && (!!yesterday.workout || (present(yesterday.load) && !!norm.load && yesterday.load >= norm.load * HEAVY_LOAD_RATIO));

  // Утром сегодняшнего стресса ещё нет — серию берём по трём прошлым дням.
  const streakDays = today && present(today.stress) ? [2, 1, 0] : [3, 2, 1];
  const streak = streakDays.map((a) => byAgo.get(a)).map((d) => (d ? d.stress : null));
  const stressBase = normOf(p.days.filter((d) => d.ago > streakDays[0]), (d) => d.stress);
  const stressStreak = stressBase !== null && streak.every((v) => present(v) && v >= stressBase + STRESS_STREAK_UP);
  const tense = !!yesterday && present(yesterday.stress) && norm.dayStress !== null && yesterday.stress >= norm.dayStress + TENSE_DAY_UP;

  const nights = [2, 1, 0].map((a) => asleepMin(byAgo.get(a)));
  // Всё позже — три ночи по нарастающей, и уже вчерашняя позже обычного (одна поздняя ночь — не сдвиг режима).
  const drift =
    nights.every(present) && nights[0] < nights[1] && nights[1] < nights[2] && nights[2] - nights[0] >= DRIFT_MIN &&
    norm.asleep !== null && nights[1] - norm.asleep >= DRIFT_MIDDLE_MIN && bedLate >= LATER_BED_MIN;
  const sleeps = [2, 1, 0].map((a) => byAgo.get(a)).map((d) => (d ? d.sleepMin : null));
  const short = (v) => present(v) && (v < SHORT_SLEEP_MIN || (norm.sleepMin !== null && v <= norm.sleepMin - SHORT_SLEEP_UNDER_NORM));

  let lowActivity = false;
  if (today && present(today.steps) && today.stepNorm && now >= LOW_ACTIVITY_FROM) {
    lowActivity = today.steps < today.stepNorm * Math.min(1, (now - 8 * 60) / (13 * 60)) * LOW_ACTIVITY_SHARE;
  }

  return {
    byAgo, today, yesterday, norm, now,
    evening: p.mode === 'evening',
    act: planActions(p, now, today),
    // Совет про кофе к месту, пока окно открыто (или кофе сегодня лучше не пить вовсе).
    coffeeOpen: now >= NIGHT_UNTIL && (p.plan.noCoffee || (!!p.plan.coffee && now < clockMin(p.plan.coffee.until))),
    pulseUp, hrvDrop, strain, recovered, pulseText, hrvText,
    bedLate,
    lateMeal: lateMeals.length ? lateMeals[lateMeals.length - 1] : null,
    heavy, streak, stressBase, stressStreak, tense,
    drift, sleeps, shortStreak: sleeps.every(short),
    debt: p.plan.bedtime ? p.plan.bedtime.debtMinutes : 0,
    snackDay: [yesterday, today].find((d) => d && d.meals.length >= SNACKS_FROM) || null,
    lowActivity,
  };
}

// ── Разговор за день ────────────────────────────────────────────────────────────────────────────

/**
 * Тема наблюдения: одна история — одна тема. Ночь — сон, засыпание, долг сна и то, как тело
 * восстановилось; её человек и так видит на «Сне» и в карточке «Режим сна».
 */
const TOPIC_OF = {
  'late-meal': 'food', 'many-meals': 'food', 'today-meals': 'food',
  'bed-late': 'night', 'bed-drift': 'night', 'bed-irregular': 'night', 'sleep-short': 'night', 'sleep-long': 'night',
  'sleep-debt': 'night', 'deep-low': 'night', 'deep-high': 'night', 'night-pulse-up': 'night', 'night-pulse-down': 'night',
  'hrv-down': 'night', 'hrv-up': 'night', 'night-summary': 'night',
  'stress-days': 'stress', 'stress-up': 'stress', 'today-stress': 'stress',
  'workout-yesterday': 'movement', 'steps-low': 'movement', 'steps-done': 'movement', 'today-steps': 'movement',
  'yesterday-move': 'movement',
  // Наблюдения запасного шага (`observe`).
  'after-workout': 'movement', 'stress-streak': 'stress', 'night-strain': 'night', 'bedtime-drift': 'night',
  'short-sleep': 'night', 'late-bed': 'night', snacks: 'food', 'low-activity': 'movement', 'good-recovery': 'night',
};
const TOPIC_TEXT = { night: 'ночь и сон', food: 'еда', stress: 'напряжение', movement: 'движение' };
/** Другая тема (не ночь) — главной не больше стольких раз за цикл. */
const TOPIC_MAX_PER_CYCLE = 2;
/** Шаги до нормы и сама норма — один совет. */
const SAME_ACTION = { norm: 'steps' };
const actionKey = (key) => SAME_ACTION[key] || key;

/**
 * Приложение без памяти о метках (старая сборка) присылает только тексты: тему и действие угадываем
 * по словам. Грубо, но для «не повторяй» этого хватает.
 */
const TOPIC_WORDS = {
  night: /(лечь|лягте|ложит|засып|уснул|режим|отбой|недосып|выспал|ночь|ночью)/,
  food: /(ужин|завтрак|обед|перекус|поесть|приём пищи|приёма пищи|еда|еды)/,
  stress: /(стресс|напряж|взвод|струн|передышк|выдохн|с работой|дела\b)/,
  movement: /(шаг|трениров|кардио|интервал|силов|прогул|пробеж|нагрузк)/,
};
const ACTION_WORDS = [
  ['bed', /(лечь|лягте|ложитесь)/],
  ['dinner', /(поужина|ужин\S* (в|по)|последний приём)/],
  ['coffee', /(кофе|чашк)/],
  ['workout', /(трениров|кардио|интервал|силов|растяжк|кругов)/],
  ['meal', /перекус/],
  ['steps', /(шаг|прогулк)/],
];

/**
 * Что Лис уже говорил — по порядку, последнее в конце: сегодня ли это, текст, темы и действие.
 * `said` — метки от приложения, по одной на каждую строку `recent`; нет — угадываем по словам.
 */
function pastOpinions(p) {
  const meta = Array.isArray(p.said) && p.said.length === p.recent.length ? p.said : null;
  return p.recent.map((line, i) => {
    const lead = /^(сегодня|вчера|раньше) (утром|днём|вечером) — /.exec(line);
    const text = lead ? line.slice(lead[0].length) : line;
    const lower = text.toLowerCase();
    const known = meta ? meta[i] : null;
    const tagged = known ? [...new Set(known.focus.map((id) => TOPIC_OF[id]).filter(Boolean))] : [];
    const topics = tagged.length ? tagged : Object.keys(TOPIC_WORDS).filter((t) => TOPIC_WORDS[t].test(lower));
    const guess = ACTION_WORDS.find(([, re]) => re.test(lower));
    const action = known && known.action ? known.action : guess ? guess[0] : null;
    return { today: !!lead && lead[1] === 'сегодня', slot: lead ? lead[2] : null, text, topics, action: action && actionKey(action) };
  });
}

/**
 * Что можно сказать сейчас, чтобы разговор не ходил по кругу:
 * - ночь — главной одна за цикл (обычно утром);
 * - другая тема — не больше TOPIC_MAX_PER_CYCLE раз за цикл и не три мнения подряд (со вчерашними);
 * - вечер не возвращается к темам, которые уже звучали сегодня: день может развить утреннюю мысль,
 *   а вечер — итог дня о другом;
 * - действие — одно за цикл; окно сна — только вечером (утром и днём его показывает «Режим сна»).
 * Советовать больше нечего — хотя бы не то же, что в прошлый раз.
 */
function conversation(p, m) {
  const past = pastOpinions(p);
  const today = past.filter((o) => o.today);
  const blocked = new Set();
  if (today.some((o) => o.topics.includes('night'))) blocked.add('night');
  if (p.mode === 'evening') for (const o of today) for (const t of o.topics) blocked.add(t);
  const [a, b] = past.slice(-2);
  for (const topic of ['food', 'stress', 'movement']) {
    if (today.filter((o) => o.topics.includes(topic)).length >= TOPIC_MAX_PER_CYCLE) blocked.add(topic);
    if (a && b && a.topics.includes(topic) && b.topics.includes(topic)) blocked.add(topic);
  }
  const used = new Set(today.map((o) => o.action).filter(Boolean));
  const last = past.length ? past[past.length - 1].action : null;
  const bedOk = p.mode === 'evening' || m.now < NIGHT_UNTIL;
  const pick = (ok) => Object.fromEntries(Object.entries(m.act).filter(([key]) => (key !== 'bed' || bedOk) && ok(actionKey(key))));
  let act = pick((key) => !used.has(key));
  if (!Object.keys(act).length) act = pick((key) => key !== last);
  return { past, today, blocked, used, act };
}

/**
 * Как идёт день — не отклонения, а факты, из которых Лис может взять тему, когда необычного нет
 * или его уже обсудили (владелец 26.09: «лучше всегда о разных вещах»). Без порогов и выводов.
 */
function dayFacts(p, m) {
  const { today, yesterday, norm } = m;
  const facts = [];
  const add = (id, text) => facts.push({ id, text });
  if (today && present(today.steps) && today.stepNorm && p.mode !== 'morning') {
    let busiest = '';
    if (p.hours && p.hours.steps.some((v) => v > 0)) {
      const i = p.hours.steps.indexOf(Math.max(...p.hours.steps));
      busiest = `, больше всего шагов — с ${p.hours.from + i}:00 до ${p.hours.from + i + 1}:00`;
    }
    add('today-steps', `к ${p.time} — ${count(today.steps)} шагов, норма дня ${count(today.stepNorm)}${busiest}`);
  }
  if (today && today.meals.length && p.mode !== 'morning') {
    const usualCount = norm.meals !== null ? ` — обычно приёмов пищи за день около ${Math.round(norm.meals)}` : '';
    add('today-meals', `сегодня еда около ${today.meals.join(', ')}${usualCount}`);
  }
  if (today && present(today.stress) && norm.dayStress !== null && p.mode !== 'morning') {
    add('today-stress', `стресс днём сегодня ${today.stress}${usual(norm.dayStress)}`);
  }
  if (yesterday && p.mode === 'morning') {
    const moved = [
      present(yesterday.steps) && `вчера ${count(yesterday.steps)} шагов${yesterday.stepNorm ? ` при норме ${count(yesterday.stepNorm)}` : ''}`,
      yesterday.workout && `вчера тренировка (${WORKOUT_TEXT[yesterday.workout]})`,
    ].filter(Boolean);
    if (moved.length) add('yesterday-move', moved.join(', '));
  }
  if (today && present(today.sleepMin) && p.mode === 'morning') {
    add('night-summary', `сон ${hm(today.sleepMin)}${usual(norm.sleepMin, hm)}${today.asleep ? `, уснули в ${today.asleep}` : ''}`);
  }
  return facts;
}

/** Задача Лиса в этот раз — по отрезку дня и тому, что уже сказано сегодня. */
function slotRole(p, talk) {
  const said = talk.today.length > 0;
  if (p.mode === 'morning') return 'как прошла ночь и почему — причина во вчерашнем дне; действие — на день, не про сон.';
  if (p.mode === 'day') {
    return said
      ? 'разверни утреннюю мысль дальше, по-новому — что сделать сегодня, чтобы завтра было лучше, — или возьми новую тему из того, как идёт день. Утреннее действие и слова не повторяй.'
      : 'как идёт день: движение, еда, напряжение — и что успеть до вечера.';
  }
  return said
    ? 'итог дня: как он прошёл и получилось ли то, что ты советовал; действие — на вечер. Не повторяй дневные темы и слова.'
    : 'итог дня: как он прошёл — движение, еда, напряжение; действие — на вечер.';
}

/**
 * Что Vuelo заметил по кольцу — всё, что заметно отличается от обычного для человека, с метками.
 * Это вход для ИИ-анализа (как «составляющие» у Oura Advisor): что из этого главное, что с чем
 * связано и почему — решает модель. Плюс что в норме.
 */
function signals(p, m = measure(p)) {
  const { today, yesterday, norm } = m;
  const flagged = [];
  const add = (id, text) => flagged.push({ id, text });

  if (m.lateMeal) add('late-meal', `вчера последний приём пищи в ${m.lateMeal}${usual(norm.lastMeal, clockOf)}`);
  if (m.snackDay) {
    const when = m.snackDay === today ? 'сегодня' : 'вчера';
    add('many-meals', `${when} ${m.snackDay.meals.length} приёмов пищи: ${m.snackDay.meals.join(', ')}${usual(norm.meals)}`);
  }
  if (m.drift) {
    add('bed-drift', `засыпание три ночи подряд всё позже: ${[2, 1, 0].map((a) => m.byAgo.get(a).asleep).join(', ')}${usual(norm.asleep, clockOf)}`);
  } else if (m.bedLate !== null && m.bedLate >= LATER_BED_MIN) {
    add('bed-late', `этой ночью уснули в ${today.asleep}${usual(norm.asleep, clockOf)}`);
  }
  const bedtimes = p.days.map(asleepMin).filter(present);
  if (!m.drift && bedtimes.length >= 4 && Math.max(...bedtimes) - Math.min(...bedtimes) >= IRREGULAR_SPREAD_MIN) {
    add('bed-irregular', `время засыпания за неделю скачет: от ${clockOf(Math.min(...bedtimes))} до ${clockOf(Math.max(...bedtimes))}`);
  }
  if (m.shortStreak) {
    add('sleep-short', `сон три ночи подряд короткий: ${m.sleeps.map(hm).join(', ')}${usual(norm.sleepMin, hm)}`);
  } else if (today && present(today.sleepMin) && norm.sleepMin !== null) {
    if (today.sleepMin <= norm.sleepMin - SHORT_SLEEP_UNDER_NORM) add('sleep-short', `сон этой ночью ${hm(today.sleepMin)}${usual(norm.sleepMin, hm)}`);
    else if (today.sleepMin >= norm.sleepMin + LONG_SLEEP_OVER_NORM) add('sleep-long', `сон этой ночью ${hm(today.sleepMin)}${usual(norm.sleepMin, hm)}`);
  }
  if (m.debt >= SLEEP_DEBT_MIN) add('sleep-debt', `накопился долг сна ${duration(m.debt)}`);
  if (today && present(today.deepMin) && norm.deepMin) {
    const change = today.deepMin / norm.deepMin - 1;
    const text = `глубокий сон ${hm(today.deepMin)}${usual(norm.deepMin, hm)}`;
    if (change <= -DEEP_CHANGE) add('deep-low', text);
    else if (change >= DEEP_CHANGE) add('deep-high', text);
  }
  if (m.pulseUp !== null && m.pulseUp >= STRAIN_PULSE_UP) add('night-pulse-up', m.pulseText);
  else if (m.pulseUp !== null && m.pulseUp <= -RECOVERY_PULSE_DOWN) add('night-pulse-down', m.pulseText);
  if (m.hrvDrop !== null && m.hrvDrop >= STRAIN_HRV_DROP) add('hrv-down', m.hrvText);
  else if (m.hrvDrop !== null && m.hrvDrop <= -RECOVERY_HRV_UP) add('hrv-up', m.hrvText);
  if (m.stressStreak) {
    add('stress-days', `стресс днём несколько дней подряд выше обычного: ${m.streak.join(', ')}${usual(m.stressBase)}`);
  } else if (m.tense) {
    add('stress-up', `вчера стресс днём ${yesterday.stress}${usual(norm.dayStress)}`);
  } else if (today && present(today.stress) && norm.dayStress !== null && today.stress >= norm.dayStress + TENSE_DAY_UP) {
    add('stress-up', `сегодня стресс днём ${today.stress}${usual(norm.dayStress)}`);
  }
  if (m.heavy) {
    add('workout-yesterday', yesterday.workout
      ? `вчера была тренировка (${WORKOUT_TEXT[yesterday.workout]})`
      : `вчера нагрузка ${yesterday.load}${usual(norm.load)}`);
  }
  if (m.lowActivity) add('steps-low', `к ${p.time} — ${count(today.steps)} шагов из нормы ${count(today.stepNorm)}`);
  else if (today && present(today.steps) && today.stepNorm && today.steps >= today.stepNorm) {
    add('steps-done', `норма шагов уже выполнена: ${count(today.steps)} из ${count(today.stepNorm)}`);
  }

  const ids = new Set(flagged.map((s) => s.id));
  const hit = (...list) => list.some((id) => ids.has(id));
  const normal = [
    today && today.asleep && !hit('bed-drift', 'bed-late', 'bed-irregular') && 'время засыпания',
    today && present(today.sleepMin) && !hit('sleep-short', 'sleep-long') && 'длительность сна',
    (m.pulseUp !== null || m.hrvDrop !== null) && !hit('night-pulse-up', 'night-pulse-down', 'hrv-down', 'hrv-up') && 'восстановление ночью',
    today && present(today.stress) && !hit('stress-days', 'stress-up') && 'стресс',
    !hit('late-meal', 'many-meals') && 'время еды',
    today && present(today.steps) && !hit('steps-low', 'steps-done') && 'шаги',
  ].filter(Boolean);
  return { flagged, normal };
}

/**
 * С какими действиями плана сочетается наблюдение: действие должно помогать именно с ним.
 * Защищает от «легли поздно — поешьте по графику» (владелец 26.09: «бред»).
 */
const FITS = {
  'late-meal': ['dinner', 'bed'],
  'many-meals': ['meal', 'dinner'],
  'bed-late': ['bed', 'coffee'],
  'bed-drift': ['bed', 'coffee'],
  'bed-irregular': ['bed', 'coffee'],
  'sleep-short': ['bed', 'coffee'],
  'sleep-debt': ['bed', 'coffee'],
  'sleep-long': ['workout', 'steps', 'norm'],
  'deep-low': ['bed', 'coffee', 'dinner'],
  'deep-high': ['workout', 'steps', 'norm'],
  'night-pulse-up': ['bed', 'coffee', 'dinner', 'workout'],
  'hrv-down': ['bed', 'coffee', 'dinner', 'workout'],
  'night-pulse-down': ['workout', 'steps', 'norm'],
  'hrv-up': ['workout', 'steps', 'norm'],
  'stress-days': ['bed', 'workout', 'steps'],
  'stress-up': ['bed', 'workout', 'steps'],
  'workout-yesterday': ['workout', 'bed', 'steps', 'norm'],
  'steps-low': ['steps', 'workout'],
  'steps-done': ['bed', 'workout'],
};

/** То же для фактов дня (`dayFacts`). */
const FACT_FITS = {
  'today-steps': ['steps', 'norm', 'workout'],
  'today-meals': ['meal', 'dinner'],
  'today-stress': ['workout', 'steps', 'bed'],
  'yesterday-move': ['workout', 'steps', 'norm', 'coffee'],
  'night-summary': ['coffee', 'workout', 'steps', 'norm'],
};
const fits = (id, action) => (FITS[id] || FACT_FITS[id] || []).includes(action);

/**
 * Запасной режим: главное наблюдение выбирает правило, по порядку важности (как ежедневные
 * сообщения Oura): что видно, причина (или null — не гадаем) и одно действие.
 * Нужен, когда ответ ИИ-анализа не прошёл проверку. Темы, которые уже обсудили сегодня, и советы,
 * которые уже давали, пропускаются (`conversation`); ничего необычного не осталось — тема из того,
 * как идёт день (`dayFacts`).
 */
function observe(p, m = measure(p), talk = conversation(p, m)) {
  const { today, yesterday, norm, evening } = m;
  const act = talk.act;
  const action = (...keys) => keys.map((k) => act[k]).find(Boolean) || null;
  const fresh = (id) => !talk.blocked.has(TOPIC_OF[id]);
  const options = [];
  const found = (id, facts, cause, todo) => options.push({ id, facts: facts.filter(Boolean), cause, action: todo });
  const nightParts = [m.pulseText, m.hrvText].filter(Boolean);
  const strainFact = `этой ночью тело отдыхало хуже обычного: ${nightParts.join(', ')}`;
  const bedFact = m.bedLate !== null && `уснули в ${today.asleep}${usual(norm.asleep, clockOf)}`;
  // Не восстановились: днём — кофе пораньше или тренировка полегче, вечером — лечь вовремя.
  const easyDay = () => action(!evening && m.coffeeOpen ? 'coffee' : 'bed', 'workout', 'bed', 'coffee');

  if (fresh('late-meal') && m.lateMeal && (m.strain || (m.bedLate !== null && m.bedLate >= LATE_BED_MIN))) {
    found(
      'late-meal',
      [`вчера последний приём пищи в ${m.lateMeal}${usual(norm.lastMeal, clockOf)}`, m.strain && strainFact, m.bedLate >= LATER_BED_MIN && bedFact],
      'поздний ужин — ночью телу пришлось переваривать, а не отдыхать',
      action('dinner', 'bed'),
    );
  }
  if (fresh('after-workout') && m.strain && m.heavy) {
    const what = yesterday.workout ? `вчера была тренировка (${WORKOUT_TEXT[yesterday.workout]})` : 'вчера нагрузка была заметно выше обычной';
    found('after-workout', [what, strainFact], 'вчерашняя нагрузка — телу нужно больше времени, чтобы восстановиться', action(evening ? 'bed' : 'workout', 'steps', 'bed'));
  }
  if (fresh('stress-streak') && m.stressStreak) {
    found(
      'stress-streak',
      [`стресс днём выше обычного несколько дней подряд: ${m.streak.join(', ')}${usual(m.stressBase)}`, m.strain && strainFact],
      'вы давно без передышки — много дел, голова не отключается',
      action(evening ? 'bed' : 'workout', 'steps', 'bed'),
    );
  }
  if (fresh('night-strain') && m.strain) {
    if (m.tense) {
      found('night-strain', [strainFact, `вчера днём стресс ${yesterday.stress}${usual(norm.dayStress)}`],
          'напряжённый день — голова долго не отпускала дела', action('bed', 'workout', 'coffee'));
    } else {
      found('night-strain', [strainFact], 'бокал-другой вчера вечером или кофе после обеда', easyDay());
    }
  }
  if (fresh('bedtime-drift') && m.drift) {
    const times = [2, 1, 0].map((a) => m.byAgo.get(a).asleep).join(', ');
    found('bedtime-drift', [`засыпание три ночи подряд всё позже: ${times}${usual(norm.asleep, clockOf)}`],
      'вечер каждый раз затягивается — дела переезжают на ночь', action('bed', 'coffee'));
  }
  if (fresh('short-sleep') && m.shortStreak) {
    found('short-sleep', [`сон три последние ночи: ${m.sleeps.map(hm).join(', ')}${usual(norm.sleepMin, hm)}`], 'накопилась усталость', action('bed', 'coffee'));
  }
  if (fresh('late-bed') && m.bedLate !== null && m.bedLate >= LATE_BED_MIN) found('late-bed', [bedFact], null, action('bed', 'coffee'));
  if (fresh('snacks') && m.snackDay) {
    const when = m.snackDay === today ? 'сегодня' : 'вчера';
    found('snacks', [`${when} ${m.snackDay.meals.length} приёмов пищи: ${m.snackDay.meals.join(', ')}`], 'много перекусов', action('meal', 'dinner'));
  }
  if (fresh('low-activity') && m.lowActivity) {
    found('low-activity', [`к ${p.time} — ${count(today.steps)} шагов из ${count(today.stepNorm)}`], 'день выходит сидячим', action('steps', 'workout'));
  }
  const sleptEnough = today && present(today.sleepMin) && today.sleepMin >= (norm.sleepMin !== null ? norm.sleepMin : 420) - 15;
  const noNorms = m.pulseUp === null && m.hrvDrop === null && p.scores.sleep >= 85 && p.scores.organism >= 80;
  if (fresh('good-recovery') && sleptEnough && (m.recovered || noNorms)) {
    found('good-recovery', [`сон ${hm(today.sleepMin)}`, nightParts.length && `ночью тело отлично отдохнуло: ${nightParts.join(', ')}`],
      'тело отлично восстановилось', action(evening ? 'bed' : 'workout', 'norm'));
  }
  // Необычного нет или его уже обсудили — тема из того, как идёт день, с подходящим действием.
  for (const f of dayFacts(p, m)) if (fresh(f.id)) found(f.id, [f.text], null, action(...FACT_FITS[f.id]));
  // Первое по важности, к которому ещё есть что посоветовать; советовать нечего — просто первое.
  const pick = options.find((o) => o.action) || options[0];
  if (pick) return pick;
  found('steady', ['сон, восстановление и нагрузка — как обычно'], 'ровный режим', action(evening ? 'bed' : 'workout', 'meal', 'steps', 'bed', 'norm', 'coffee'));
  return options[0];
}

// ── Ответ модели ────────────────────────────────────────────────────────────────────────────────

/** Длиннее приложение не покажет (`AI_ADVICE_MAX_CHARS`), короче — это не мнение (`AI_ADVICE_MIN_CHARS`). */
const ANSWER_MIN_CHARS = 20;
const ANSWER_MAX_CHARS = 220;

/** Расплывчатые фразы, за которые владелец ругал ответы (26.09): с ними просим модель переписать. */
const VAGUE = [
  /что-?то (задерж|помеш|случил|отвлек|произош|пошло)/,
  /каки[ех]-?то (дел|причин|обстоятельств)/,
  /по какой-?то причине/,
  /время для себя/,
  /не перегружайте себя/,
  /берегите себя/,
];

/**
 * Пересказ карточек (владелец 26.09: «я и так даю пользователю инфу, что у него сбит режим, — на
 * главном экране, практически теми же словами»): с ними просим модель переписать.
 */
const CARD_REPEAT = [
  /режим\S*(\s+\S+){0,3}\s+(сбил|сбит|наруш|поехал|съехал)/,
  /(сбил|сбит|наруш|поехал|съехал)\S*(\s+\S+){0,2}\s+режим/,
  /долг\S* (сна|по сну)/,
  /окн\S* (для )?кофе/,
  /кофейн\S* окн/,
];

/** Текст ответа: без «Ответ:» / «Лис:» в начале и рассуждений, если модель их всё же дописала. */
function parseAnswer(raw) {
  let text = String(raw).replace(/\*/g, '').trim();
  const lead = /(?:Лис|Ответ)\s*:\s*/.exec(text);
  if (lead) text = text.slice(lead.index + lead[0].length);
  else if (/Думаю\s*:/.test(text)) return null;
  text = text.replace(/Думаю\s*:[\s\S]*$/, '').replace(/^[→—–-]+/, '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Числа в тексте: «07:00» и «7:00», «11 000» и «11000» — одно и то же. */
const numbersIn = (s) =>
  (s.match(/\d+(?:[:.\u00a0 ]\d+)*/g) || []).map((t) => t.replace(/[\u00a0 ]/g, '').replace('.', ':').replace(/^0(\d)/, '$1'));

/** Что не так с ответом: null — годится. Числа — только из действия, его время — обязательно. */
function answerProblem(text, action = null) {
  if (text.length < ANSWER_MIN_CHARS) return 'short';
  if (text.length > ANSWER_MAX_CHARS) return 'long';
  const lower = text.toLowerCase();
  if (VAGUE.some((re) => re.test(lower))) return 'vague';
  if (CARD_REPEAT.some((re) => re.test(lower))) return 'card';
  const allowed = numbersIn(action || '');
  const used = numbersIn(text);
  if (used.some((n) => !allowed.includes(n))) return 'numbers';
  const times = allowed.filter((n) => n.includes(':'));
  if (times.length && !used.some((n) => times.includes(n))) return 'no-time';
  // «По графику Vuelo» без времени — ссылка на план ни о чём.
  if (/график\S* vuelo/.test(lower) && !/\d?\d:\d\d/.test(text)) return 'vague';
  return null;
}

/**
 * Ответ ИИ-анализа — четыре строки: «Главное: [метки]», «Причина: …», «Действие: [метка]», «Лис: …».
 * Не разобрать — поля null / пустые, проверка это поймает.
 */
function parseAnalysis(raw) {
  const text = String(raw).replace(/\*/g, '');
  const line = (name) => {
    const found = new RegExp(`${name}\\s*:\\s*(.*)`).exec(text);
    return found ? found[1].trim() : '';
  };
  const said = /Лис\s*:\s*([\s\S]*)$/.exec(text);
  return {
    focus: line('Главное').match(/[a-z]+(?:-[a-z]+)*/g) || [],
    cause: line('Причина') || null,
    action: (line('Действие').match(/[a-z]+/) || [null])[0],
    text: said ? said[1].replace(/\s+/g, ' ').trim() || null : null,
  };
}

/**
 * Что не так с ответом ИИ-анализа: null — годится. Главное — из того, что заметил Vuelo и что ещё
 * не обсуждали (`seen.flagged`), или из фактов дня (`seen.facts`); уже обсуждённое можно упомянуть,
 * но главным оно не считается. Действие — из доступных сейчас и подходит к главному (`FITS`);
 * текст — по правилам `answerProblem`.
 */
function analysisProblem(answer, seen, act) {
  if (!answer.text) return 'format';
  if (!answer.action || !has(act, answer.action)) return 'action';
  const usable = [...seen.flagged, ...(seen.facts || [])];
  const focus = answer.focus.filter((id) => usable.some((s) => s.id === id));
  if (usable.length && !focus.length) return 'focus';
  if (focus.length && !focus.some((id) => fits(id, answer.action))) return 'mismatch';
  return answerProblem(answer.text, act[answer.action]);
}

/** Главное ответа — только настоящие метки из того, что ушло модели. */
const focusOf = (answer, seen) => answer.focus.filter((id) => [...seen.flagged, ...(seen.facts || [])].some((s) => s.id === id));

/**
 * Что уходит ИИ-анализу: свежие наблюдения (темы, которые сегодня ещё не обсуждали), уже обсуждённые
 * (только как фон), факты дня по свежим темам и действия, которые ещё можно советовать.
 */
function offer(p, m = measure(p), talk = conversation(p, m), seen = signals(p, m)) {
  const fresh = (id) => !talk.blocked.has(TOPIC_OF[id]);
  return {
    flagged: seen.flagged.filter((s) => fresh(s.id)),
    known: seen.flagged.filter((s) => !fresh(s.id)),
    facts: dayFacts(p, m).filter((f) => fresh(f.id)),
    normal: seen.normal,
    act: talk.act,
    talk,
  };
}

// ── Запрос ──────────────────────────────────────────────────────────────────────────────────────

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScore = (v) => v === null || (typeof v === 'number' && v >= 0 && v <= 100);
const isNum = (v, min, max) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isClock = (v) => typeof v === 'string' && /^\d\d:\d\d$/.test(v);
const isClockOrNull = (v) => v === null || isClock(v);
/** Короткая подпись из приложения («Спокойное кардио», «Обед»): без переводов строк и разметки. */
const isLabel = (v, max = 40) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\n\r<>{}]/.test(v);

function validateProfile(p) {
  return (
    isObject(p) &&
    (p.sex === null || has(SEX_TEXT, p.sex)) &&
    isNum(p.age, 5, 120) &&
    isNum(p.heightCm, 50, 260) &&
    isNum(p.weightKg, 20, 350) &&
    (p.goal === null || has(GOAL_TEXT, p.goal))
  );
}

function validateDay(d) {
  return (
    isObject(d) &&
    isInt(d.ago, 0, 14) &&
    isClockOrNull(d.asleep) &&
    isClockOrNull(d.awake) &&
    isNum(d.sleepMin, 0, 1440) &&
    isNum(d.deepMin, 0, 1440) &&
    isNum(d.nightPulse, 20, 220) &&
    isNum(d.hrv, 0, 400) &&
    isNum(d.restingPulse, 20, 220) &&
    isNum(d.spo2, 50, 100) &&
    isNum(d.stress, 0, 100) &&
    isNum(d.steps, 0, 200000) &&
    isNum(d.stepNorm, 0, 50000) &&
    isNum(d.calories, 0, 20000) &&
    isNum(d.load, 0, 5000) &&
    (d.workout === null || has(WORKOUT_TEXT, d.workout)) &&
    Array.isArray(d.meals) &&
    d.meals.length <= 12 &&
    d.meals.every(isClock)
  );
}

function validatePlan(plan) {
  if (!isObject(plan) || typeof plan.noCoffee !== 'boolean') return false;
  const w = plan.workout;
  const workoutOk =
    w === null ||
    (isObject(w) && isLabel(w.title) && isLabel(w.effort) && typeof w.minutes === 'number' && isNum(w.minutes, 0, 300) &&
      isClock(w.from) && isClock(w.to));
  const c = plan.coffee;
  const coffeeOk = c === null || (isObject(c) && isClock(c.from) && isClock(c.until) && isNum(c.cups, 0, 10));
  const mealsOk =
    Array.isArray(plan.meals) && plan.meals.length <= 6 && plan.meals.every((m) => isObject(m) && isLabel(m.title, 20) && isClock(m.time));
  const b = plan.bedtime;
  const bedtimeOk =
    b === null ||
    (isObject(b) && isClock(b.from) && isClock(b.to) && isClock(b.wake) &&
      typeof b.needMinutes === 'number' && isNum(b.needMinutes, 0, 1440) &&
      typeof b.debtMinutes === 'number' && isNum(b.debtMinutes, 0, 3000));
  return workoutOk && coffeeOk && mealsOk && bedtimeOk;
}

/** Проверка тела запроса: только ожидаемые поля и разумные значения. Возвращает причину отказа или null. */
function validate(p) {
  if (!isObject(p)) return 'body';
  if (!has(MODE_TEXT, p.mode)) return 'mode';
  if (!isClock(p.time)) return 'time';
  if (!validateProfile(p.profile)) return 'profile';
  const sc = p.scores;
  if (!isObject(sc) || !isScore(sc.total) || !isScore(sc.sleep) || !isScore(sc.activity) || !isScore(sc.organism)) return 'scores';
  if (!Array.isArray(p.days) || p.days.length > 15 || !p.days.every(validateDay)) return 'days';
  const h = p.hours;
  if (h !== null && (!isObject(h) || !isInt(h.from, 0, 23) || !Array.isArray(h.steps) || h.steps.length > 24 || !h.steps.every((v) => isNum(v, 0, 50000) && v !== null))) {
    return 'hours';
  }
  if (!validatePlan(p.plan)) return 'plan';
  if (!Array.isArray(p.recent) || p.recent.length > 5 || p.recent.some((t) => typeof t !== 'string' || t.length > 400)) {
    return 'recent';
  }
  // Необязательно (старые сборки не шлют): метки прошлых мнений, по одной на строку `recent`.
  if (p.said !== undefined && !validateSaid(p.said, p.recent.length)) return 'said';
  return null;
}

const isTag = (v) => typeof v === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(v) && v.length <= 30;
function validateSaid(said, length) {
  return (
    Array.isArray(said) &&
    said.length === length &&
    said.every((x) => x === null || (isObject(x) && Array.isArray(x.focus) && x.focus.length <= 4 && x.focus.every(isTag) && (x.action === null || isTag(x.action))))
  );
}

const plural = (n, forms) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
};
function count(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function duration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}
/** «7:20» — длительность сна. */
function hm(min) {
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
}
const joined = (parts) => parts.filter(Boolean).join(', ');

/** Человек: пол, возраст, рост, вес и цель — только то, что заполнено в профиле. */
function personLine(pr) {
  const person = joined([
    pr.sex && SEX_TEXT[pr.sex],
    pr.age !== null && `${pr.age} ${plural(pr.age, ['год', 'года', 'лет'])}`,
    pr.heightCm !== null && `рост ${pr.heightCm} см`,
    pr.weightKg !== null && `вес ${pr.weightKg} кг`,
  ]);
  return `Человек: ${person || 'профиль не заполнен'}. Цель: ${pr.goal ? GOAL_TEXT[pr.goal] : 'не указана'}.`;
}

/**
 * Что Лис уже говорил — с тем, когда («сегодня утром — …»; приложение подписывает сама), и о чём
 * это было: тема и совет, чтобы модель видела, что уже сказано.
 */
function recentLine(p, talk) {
  if (!p.recent.length) return [];
  const about = (o) => {
    const parts = [o.topics.length && `тема: ${o.topics.map((t) => TOPIC_TEXT[t]).join(', ')}`, o.action && `совет: [${o.action}]`].filter(Boolean);
    return parts.length ? ` (${parts.join('; ')})` : '';
  };
  return ['Что ты уже говорил этому человеку:', ...p.recent.map((t, i) => `- ${t}${talk ? about(talk.past[i]) : ''}`)];
}

/** Что сегодня уже обсуждали: темы — главными не брать, советы — не повторять. */
function discussedLine(talk) {
  const topics = [...talk.blocked].map((t) => TOPIC_TEXT[t]);
  const used = [...talk.used].map((a) => `[${a}]`);
  return [
    topics.length && `Уже обсуждали — главным не бери: ${topics.join(', ')}.`,
    used.length && `Уже советовал сегодня — не повторяй: ${used.join(', ')}.`,
  ].filter(Boolean);
}

/**
 * Вход ИИ-анализа: кто человек, что заметил Vuelo (свежие темы — с метками, уже обсуждённые — фоном),
 * как идёт день, что в норме, действия, которые ещё можно советовать, что уже сказано и задача сейчас.
 */
function buildAnalysisText(p, m = measure(p), seen = offer(p, m)) {
  const actions = Object.entries(seen.act).map(([key, text]) => `- [${key}] ${text}`);
  return [
    `Сейчас: ${MODE_TEXT[p.mode]}, ${p.time}.`,
    personLine(p.profile),
    'Что Vuelo заметил по кольцу (в сравнении с обычным для этого человека за неделю):',
    ...(seen.flagged.length ? seen.flagged.map((s) => `- [${s.id}] ${s.text}`) : ['- ничего необычного']),
    ...(seen.known.length ? ['Это уже обсуждали — можно упомянуть как причину, но не главным:', ...seen.known.map((s) => `- ${s.text}`)] : []),
    ...(seen.facts.length ? ['Как идёт день (не отклонения, просто факты — годятся как тема):', ...seen.facts.map((f) => `- [${f.id}] ${f.text}`)] : []),
    `В норме: ${seen.normal.length ? seen.normal.join(', ') : 'данных мало'}.`,
    'Действия из плана Vuelo на сегодня (ещё впереди):',
    ...(actions.length ? actions : ['- нет']),
    ...recentLine(p, seen.talk),
    ...discussedLine(seen.talk),
    `Твоя задача сейчас: ${slotRole(p, seen.talk)}`,
  ].join('\n');
}

/** Вход запасного шага: кто человек и одно наблюдение дня — что видно, причина, что предложить. */
function buildUserText(p, seen = observe(p), talk = null) {
  return [
    `Сейчас: ${MODE_TEXT[p.mode]}, ${p.time}.`,
    personLine(p.profile),
    'Наблюдение дня (Vuelo выбрал его по числам кольца):',
    `Что видно: ${seen.facts.join('; ')}.`,
    `Причина: ${seen.cause || 'не видна — не додумывай, скажи только о том, что видно'}.`,
    `Что предложить: ${seen.action || 'одно простое действие по теме наблюдения на ближайшие часы'}.`,
    ...recentLine(p, talk),
  ].join('\n');
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const header = (event, name) => {
  const headers = (event && event.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

async function handler(event, context) {
  if (event.httpMethod && event.httpMethod !== 'POST') return reply(405, { error: 'method' });
  const appKey = process.env.APP_KEY;
  if (!appKey || header(event, 'x-vuelo-key') !== appKey) return reply(403, { error: 'forbidden' });

  let body = event.body || '';
  if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  if (body.length > MAX_BODY_CHARS) return reply(413, { error: 'too large' });
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, { error: 'json' });
  }
  const invalid = validate(payload);
  if (invalid) return reply(400, { error: invalid });

  const token = context && context.token && context.token.access_token;
  const folder = process.env.FOLDER_ID;
  if (!token || !folder) return reply(500, { error: 'service account or FOLDER_ID is not set' });
  const model = process.env.MODEL || 'yandexgpt';

  const m = measure(payload);
  const talk = conversation(payload, m);
  const started = Date.now();
  const timeLeft = () => Math.min(LLM_TIMEOUT_MS, DEADLINE_MS - (Date.now() - started));
  // Анализу — чуть больше свободы (живее истории), запасному шагу — меньше: он только пересказывает.
  const ask = (system, user, temperature) =>
    askModel({ token, folder, model, temperature, timeoutMs: timeLeft(), messages: [{ role: 'system', text: system }, { role: 'user', text: user }] });

  // 1. ИИ-анализ: главное, причину и действие выбирает модель. Советовать нечего — сразу шаг 2.
  let problem = 'no actions';
  if (Object.keys(talk.act).length) {
    const seen = offer(payload, m, talk);
    const result = await ask(ANALYSIS_PROMPT, buildAnalysisText(payload, m, seen), 0.7);
    if (result.status) return reply(result.status, { error: result.error });
    const answer = parseAnalysis(result.text);
    problem = analysisProblem(answer, seen, talk.act);
    if (!problem) {
      return reply(200, { text: answer.text, mode: 'analysis', focus: focusOf(answer, seen), cause: answer.cause, action: actionKey(answer.action) });
    }
    // Причина — в лог функции без текста ответа: видно, как часто анализ промахивается.
    console.warn('analysis rejected', problem);
  }

  // 2. Запасной шаг: наблюдение выбирает правило, модель его только говорит. Если приложение ещё ждёт.
  if (DEADLINE_MS - (Date.now() - started) < RETRY_MIN_MS) return reply(502, { error: `answer ${problem}` });
  const seen = observe(payload, m, talk);
  const result = await ask(GUIDED_PROMPT, buildUserText(payload, seen, talk), 0.5);
  if (result.status) return reply(result.status, { error: result.error });
  const text = parseAnswer(result.text);
  const guided = text ? answerProblem(text, seen.action) : 'format';
  if (!guided) {
    const key = Object.keys(talk.act).find((k) => talk.act[k] === seen.action) || null;
    return reply(200, { text, mode: 'guided', focus: [seen.id], cause: seen.cause, action: key && actionKey(key) });
  }
  console.warn('guided rejected', guided);
  return reply(502, { error: `answer ${problem} / ${guided}` });
}

/** Один запрос к YandexGPT: `{ text }` или `{ status, error }`. */
async function askModel({ token, folder, model, messages, timeoutMs, temperature }) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-folder-id': folder,
        'x-data-logging-enabled': 'false',
      },
      body: JSON.stringify({
        modelUri: `gpt://${folder}/${model}/latest`,
        completionOptions: { stream: false, temperature, maxTokens: '300' },
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: 504, error: `llm unreachable: ${e && e.name}` };
  }
  if (!response.ok) {
    // Текст ошибки Яндекса — в лог функции (без данных пользователя): по нему видно, что не так с доступом.
    console.error('llm error', response.status, (await response.text()).slice(0, 500));
    return { status: 502, error: `llm ${response.status}` };
  }
  const data = await response.json();
  const alt = data && data.result && data.result.alternatives && data.result.alternatives[0];
  const text = alt && alt.message && typeof alt.message.text === 'string' ? alt.message.text.trim() : '';
  return text ? { text } : { status: 502, error: 'empty' };
}

module.exports = {
  handler, validate, measure, signals, observe, buildAnalysisText, buildUserText, conversation, dayFacts, offer,
  parseAnalysis, analysisProblem, parseAnswer, answerProblem, ANALYSIS_PROMPT, GUIDED_PROMPT, FITS, FACT_FITS, TOPIC_OF,
};
