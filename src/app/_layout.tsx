import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VueloProvider, useVuelo } from '../state';
import { colors } from '../ui';

function Routes() {
  const { ready, state } = useVuelo();

  useEffect(() => {
    if (ready && !state.onboarded) router.replace('/onboarding');
  }, [ready, state.onboarded]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="ring" options={{ presentation: 'modal' }} />
      <Stack.Screen name="raw-log" options={{ presentation: 'modal' }} />
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
    </Stack>
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
