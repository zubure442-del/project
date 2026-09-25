import { useWindowDimensions } from 'react-native';
import { adviceLabel, findDay, recommendationsFor, relayFor, useTabDay, useVuelo } from '../../state';
import {
  ActivityNow,
  AssistantCarousel,
  Calibration,
  CycleNotice,
  DayBanner,
  MascotHero,
  PastDayNote,
  Screen,
} from '../../ui';

export default function TodayTab() {
  const { state, statusText, sync, homeRequest, foxThinking } = useVuelo();
  const { width } = useWindowDimensions();
  const { date: picked, banner, isToday, today, hasData } = useTabDay();
  // Рекомендации (совет, питание, пик выносливости, кофейное окно, режим сна) — только за сегодня; на прошлом дне блока нет вовсе.
  const recs = recommendationsFor(state, picked);
  const relay = relayFor(state);

  return (
    <Screen
      title="Итог"
      statusText={statusText}
      onSync={() => sync('refresh')}
      banner={<DayBanner kind={banner} onRetry={() => sync('retry')} />}
    >
      {!isToday ? (
        // Прошлый день: итог и индексы считаются по циклам и тут не показываются. Замеры дня есть
        // на вкладках, поэтому здесь только пояснение.
        hasData ? (
          <PastDayNote />
        ) : (
          <Calibration today={false} />
        )
      ) : today?.hidden === null ? (
        // Сегодня — текущий цикл бодрствования: он идёт и после полуночи, пока человек не уснул.
        <>
          <MascotHero total={today.cycle?.total ?? null} relay={relay} width={width} />
          {recs ? (
            <AssistantCarousel
              // Новые данные — карусель начинается заново, с карточки «AI Ассистент».
              key={homeRequest}
              slides={recs.slides}
              advice={recs.advice?.text ?? null}
              adviceLabel={adviceLabel(picked)}
              thinking={foxThinking}
              coffee={recs.coffee}
              food={recs.food}
              endurance={recs.endurance}
              sleepMode={recs.sleepMode}
            />
          ) : null}
        </>
      ) : today?.hidden === 'calibration' || !today ? (
        // Сна ещё не было: на экране только объяснение, ни маскота, ни полоски эстафеты.
        <Calibration today returning={state.hadCompleteDay} />
      ) : (
        // Пропуск (кольцо снимали, снято сейчас или больше суток без сна): уведомление,
        // а ниже — только то, что копится само: активность цикла и шаги за сутки.
        <>
          <CycleNotice kind={today.hidden} gap={today.gap} />
          <ActivityNow activity={today.cycle?.scores.activity ?? null} steps={findDay(state.days, picked)?.steps ?? null} />
        </>
      )}
    </Screen>
  );
}
