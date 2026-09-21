import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useVuelo } from '../../state';
import { ActivityIcon, BodyIcon, ProfileIcon, SleepIcon, TabBar, colors } from '../../ui';

/** Ниже этого заряда на иконке профиля появляется точка. */
export const LOW_BATTERY = 20;

export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  const { state, profileReady, goalReady } = useVuelo();
  // Точка на «Профиле»: низкий заряд или не заполнены биометрия и цель.
  const dot = (state.battery !== null && state.battery <= LOW_BATTERY) || !profileReady || !goalReady;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Профиль',
          tabBarIcon: ({ color }) => (
            <View>
              <ProfileIcon color={color} />
              {dot ? <View style={styles.dot} /> : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen name="sleep" options={{ title: 'Сон', tabBarIcon: ({ color }) => <SleepIcon color={color} /> }} />
      <Tabs.Screen
        name="index"
        // Иконку центральной кнопки (знак V в круге) рисует сама панель: см. TabBar.tsx.
        options={{ title: 'Сегодня' }}
      />
      <Tabs.Screen name="activity" options={{ title: 'Активность', tabBarIcon: ({ color }) => <ActivityIcon color={color} /> }} />
      <Tabs.Screen name="body" options={{ title: 'Тело', tabBarIcon: ({ color }) => <BodyIcon color={color} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', top: -1, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
});
