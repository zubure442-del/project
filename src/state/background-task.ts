import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { logNote } from '../ble';
import { BACKGROUND_MIN_INTERVAL_S } from './background-plan';
import { backgroundSync } from './background-sync';

/**
 * Фоновое обновление iOS («Обновление контента»): система будит приложение по своим правилам,
 * обычно незадолго до того, как человек его открывает. Нужен механизм именно обновления,
 * а не `expo-background-task`: та ставит задачи «обработки», которые iOS запускает в основном
 * ночью на зарядке, а ночью кольцо сон не отдаёт. Фоновый режим Bluetooth уже включён
 * (плагин react-native-ble-plx), режим `fetch` добавляют плагины expo-task-manager / expo-background-fetch.
 */
export const BACKGROUND_SYNC_TASK = 'vuelo-background-sync';

// Задачу объявляем при загрузке модуля: iOS может поднять приложение в фоне только ради неё.
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  const outcome = await backgroundSync();
  return outcome === 'new'
    ? BackgroundFetch.BackgroundFetchResult.NewData
    : outcome === 'none'
      ? BackgroundFetch.BackgroundFetchResult.NoData
      : BackgroundFetch.BackgroundFetchResult.Failed;
});

/** Просим iOS будить приложение. Что вышло — строкой в отладочный лог. */
export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
      logNote(
        status === BackgroundFetch.BackgroundFetchStatus.Denied
          ? 'фоновое обновление выключено: Настройки → Основные → Обновление контента'
          : 'фоновое обновление сейчас недоступно (например, режим энергосбережения)',
      );
      return;
    }
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: BACKGROUND_MIN_INTERVAL_S });
    }
    logNote('фоновое обновление включено');
  } catch (e) {
    logNote(`фоновое обновление не включилось: ${e instanceof Error ? e.message : String(e)}`);
  }
}
