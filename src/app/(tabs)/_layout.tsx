import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useVuelo } from '../../state';
import { ActivityIcon, BodyIcon, Logo, ProfileIcon, SleepIcon, colors } from '../../ui';

/** Ниже этого заряда на иконке профиля появляется точка. */
export const LOW_BATTERY = 20;

export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  const { state } = useVuelo();
  const low = state.battery !== null && state.battery <= LOW_BATTERY;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: '#101017', borderTopColor: colors.track, height: 88 },
        tabBarLabelStyle: { fontSize: 11 },
        tabBarItemStyle: { paddingTop: 6 },
      }}
    >
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Профиль',
          tabBarIcon: ({ color }) => (
            <View>
              <ProfileIcon color={color} />
              {low ? <View style={styles.dot} /> : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen name="sleep" options={{ title: 'Сон', tabBarIcon: ({ color }) => <SleepIcon color={color} /> }} />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Сегодня',
          // Статичный знак V в оранжевом круге: никаких дуг, похожих на загрузку.
          tabBarIcon: () => (
            <View style={styles.center}>
              <Logo size={28} color={colors.bg} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="activity" options={{ title: 'Активность', tabBarIcon: ({ color }) => <ActivityIcon color={color} /> }} />
      <Tabs.Screen name="body" options={{ title: 'Тело', tabBarIcon: ({ color }) => <BodyIcon color={color} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  center: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
  },
  dot: { position: 'absolute', top: -1, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5705F' },
});
