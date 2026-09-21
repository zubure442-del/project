import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VueloProvider, useVuelo } from '../state';
import { FreshBadge, LoadingScreen, colors } from '../ui';

/** Экран загрузки плавно появляется и уходит на главный. */
const OVERLAY_FADE_MS = 400;

function Routes() {
  const { ready, state, phase, loadingMode, dismissFresh } = useVuelo();

  // Экран загрузки — поверх вкладок, а не отдельным маршрутом: выбранная вкладка сохраняется.
  // Пока он открыт, вкладки состояние не получают: оно применяется один раз в конце.
  const loading = !state.started || phase === 'loading' || phase === 'done' || phase === 'failed';
  // На входе экран появляется сразу, на обновлении по запросу — плавно.
  const fadeIn = loadingMode === 'refresh' || loadingMode === 'retry';

  // Пока читаем кэш, держим тёмный экран: иначе мелькнёт пустой главный.
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="raw-log" options={{ presentation: 'modal' }} />
      </Stack>
      {loading ? (
        <Animated.View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          entering={fadeIn ? FadeIn.duration(OVERLAY_FADE_MS) : undefined}
          exiting={FadeOut.duration(OVERLAY_FADE_MS)}
        >
          <LoadingScreen />
        </Animated.View>
      ) : null}
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
