import { Tabs } from 'expo-router';
import { ActivityIcon, BodyIcon, SleepIcon, TodayIcon, colors } from '../../ui';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: '#101017', borderTopColor: colors.cardBorder },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Сегодня', tabBarIcon: ({ color }) => <TodayIcon color={color} /> }} />
      <Tabs.Screen name="sleep" options={{ title: 'Сон', tabBarIcon: ({ color }) => <SleepIcon color={color} /> }} />
      <Tabs.Screen name="activity" options={{ title: 'Активность', tabBarIcon: ({ color }) => <ActivityIcon color={color} /> }} />
      <Tabs.Screen name="body" options={{ title: 'Тело', tabBarIcon: ({ color }) => <BodyIcon color={color} /> }} />
    </Tabs>
  );
}
