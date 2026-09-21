import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VueloProvider, useVuelo } from '../state';
import { FreshBadge } from './welcome';
import { colors } from '../ui';

function Routes() {
  const { ready, state, sync, phase, dismissFresh } = useVuelo();
  const pathname = usePathname();
  const launched = useRef(false);

  // Вход в приложение: самый первый запуск ждёт «Начать», дальше — правило 10 минут.
  useEffect(() => {
    if (!ready || launched.current) return;
    launched.current = true;
    if (state.started) sync('launch');
    else router.push('/welcome');
  }, [ready, state.started, sync]);

  // Любая синхронизация идёт только через экран загрузки: другого пути к кольцу за данными нет.
  useEffect(() => {
    if ((phase === 'loading' || phase === 'failed') && pathname !== '/welcome') router.push('/welcome');
  }, [phase, pathname]);

  // После «Очистить данные» приложение ведёт себя как при первом запуске.
  useEffect(() => {
    if (ready && launched.current && !state.started && pathname !== '/welcome') router.push('/welcome');
  }, [pathname, ready, state.started]);

  // Пока читаем кэш, держим тёмный экран: иначе мелькнёт пустой главный.
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: pathname === '/welcome' ? 'fade' : 'default',
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="raw-log" options={{ presentation: 'modal' }} />
      </Stack>
      {phase === 'fresh' ? <FreshBadge onDone={dismissFresh} /> : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <VueloProvider>
        <StatusBar style="light" />
        <Routes />
      </VueloProvider>
    </SafeAreaProvider>
  );
}
