import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FRESH_MS, VueloProvider, useVuelo } from '../state';
import { FreshBadge } from './welcome';
import { colors } from '../ui';

function Routes() {
  const { ready, state, sync, phase, dismissFresh } = useVuelo();
  const pathname = usePathname();
  const launched = useRef(false);

  // Приветствие при каждом входе, кроме случая со свежими данными.
  useEffect(() => {
    if (!ready || launched.current) return;
    launched.current = true;
    const fresh = state.lastSyncAt !== null && Date.now() - state.lastSyncAt < FRESH_MS;
    if (fresh) return;
    router.replace('/welcome');
    sync();
  }, [ready, state.lastSyncAt, sync]);

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
      <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
      <Stack.Screen name="ring" options={{ presentation: 'modal' }} />
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
