import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../ui';
import { VueloProvider } from './store';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <VueloProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      </VueloProvider>
    </SafeAreaProvider>
  );
}
