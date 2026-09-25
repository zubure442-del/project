import { handshake, logNote, runSync, type KnownRing } from '../ble';
import { loadState, saveState, type VueloState } from '../storage';
import { aiAdviceConfig, aiAdviceRequest, fetchAiAdvice, withAiAdvice } from './ai-advice';
import {
  BACKGROUND_ADVICE_MIN_MS,
  BACKGROUND_BUDGET_MS,
  BACKGROUND_CONNECT_MS,
  BACKGROUND_SKIP_TEXT,
  backgroundSkip,
} from './background-plan';
import { todayKey } from './day';
import { emitBackgroundSync, ringSession, sessionRing, toRingProfile } from './ring-session';
import { applySyncResult, newUserTodayOnly, planDays } from './sync-plan';

export type BackgroundOutcome = 'new' | 'none' | 'failed';

/** Результат — экрану, если он жив (он сохранит и перерисует), иначе прямо в хранилище. */
async function store(next: VueloState): Promise<void> {
  if (ringSession.host) ringSession.host.apply(next);
  else await saveState(next);
}

/**
 * Одна фоновая выгрузка (iOS разбудила приложение): те же дни, что и при открытии (`planDays`),
 * то же рукопожатие и тот же расчёт (`applySyncResult`), потом мнение Лиса, если осталось время.
 * Всё — в пределах BACKGROUND_BUDGET_MS. Не бросает: что вышло — строкой в отладочный лог.
 */
export async function backgroundSync(now = new Date()): Promise<BackgroundOutcome> {
  const started = Date.now();
  const left = () => BACKGROUND_BUDGET_MS - (Date.now() - started);
  let state: VueloState;
  try {
    state = ringSession.host ? ringSession.host.get() : await loadState();
  } catch {
    return 'failed';
  }
  const skip = backgroundSkip(state, { busy: ringSession.running !== null, demo: ringSession.demo }, now);
  if (skip) {
    logNote(`фоновое обновление: пропущено — ${BACKGROUND_SKIP_TEXT[skip]}`);
    return 'none';
  }

  ringSession.running = 'background';
  emitBackgroundSync({ kind: 'started' });
  let changed = false;
  try {
    const ring = sessionRing(state.ring);
    let known = null as KnownRing | null;
    ring.onKnown = (k) => {
      known = k;
    };
    ring.onStatus = () => undefined;
    await ring.connectKnown(Math.min(BACKGROUND_CONNECT_MS, left()));
    if (ring.needsHandshake()) {
      await handshake(ring, toRingProfile(state.profile), state.autoMeasureMin);
      ring.markHandshakeDone();
    }
    const plan = planDays(state.syncedAt, now, { todayOnly: newUserTodayOnly(state) });
    logNote(`фоновое обновление: ${plan.note}`);
    const result = await runSync(ring, {
      days: plan.days,
      today: todayKey(now),
      extras: true,
      // Мнению Лиса оставляем время; не успели день — он не отмечен завершённым и придёт позже.
      hardCapMs: Math.max(1000, left() - BACKGROUND_ADVICE_MIN_MS),
      onNote: logNote,
    });
    // Экран мог ожить, пока шла выгрузка (человек открыл приложение), — кладём на свежее состояние.
    const base = ringSession.host ? ringSession.host.get() : state;
    const note = `готово за ${Math.round((Date.now() - started) / 1000)} с${result.error ? ` (обрыв: ${result.error})` : ''}`;
    const next = { ...applySyncResult(base, result, known), lastBackground: { at: Date.now(), note } };
    await store(next);
    changed = true;
    logNote(`фоновое обновление: ${note}`);

    // Мнение Лиса — чтобы и оно было готово к открытию.
    const config = aiAdviceConfig();
    const request = config && left() >= BACKGROUND_ADVICE_MIN_MS ? aiAdviceRequest(next) : null;
    if (config && request) {
      const reply = await fetchAiAdvice(request.payload, config, fetch, Math.max(1000, left() - 1000));
      if ('text' in reply) {
        const current = ringSession.host ? ringSession.host.get() : next;
        const withAi = withAiAdvice(current, request, reply.text);
        if (withAi !== current) await store(withAi);
        logNote('фоновое обновление: мнение Лиса получено');
      } else {
        logNote(`фоновое обновление: мнение Лиса — ${reply.error}, остаётся шаблонное`);
      }
    }
    return 'new';
  } catch (e) {
    const note = `не удалось — ${e instanceof Error ? e.message : String(e)}`;
    logNote(`фоновое обновление: ${note}`);
    if (!changed) {
      // Отметку оставляем и при неудаче: так видно, что iOS приложение будила.
      const current = ringSession.host ? ringSession.host.get() : state;
      await store({ ...current, lastBackground: { at: Date.now(), note } }).catch(() => undefined);
    }
    return 'failed';
  } finally {
    ringSession.running = null;
    emitBackgroundSync({ kind: 'finished', changed });
  }
}
