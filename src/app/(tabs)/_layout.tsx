import { Tabs, router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { profileAlerts, todayTabLabel, useVuelo } from '../../state';
import { ActivityIcon, BodyIcon, ProfileIcon, SleepIcon, TabBar, colors } from '../../ui';

export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  const { state, selectedDate, dayView, homeRequest } = useVuelo();
  // Вход в приложение и любое обновление открывают центральную вкладку «Сегодня»:
  // после загрузки человек всегда видит главный экран, а не ту вкладку, где закрыл приложение.
  useEffect(() => {
    router.replace('/');
  }, [homeRequest]);
  // Точка на «Профиле» — только пока не заполнено хотя бы одно из пяти обязательных полей.
  // Раньше она горела и при заряде ≤ 20 %, поэтому не гасла после заполнения профиля.
  const { dot } = profileAlerts(state.profile);

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
        // «Сегодня», когда выбран сегодняшний день, иначе дата («20 сен»).
        options={{ title: todayTabLabel(selectedDate, dayView.today) }}
      />
      <Tabs.Screen name="activity" options={{ title: 'Активность', tabBarIcon: ({ color }) => <ActivityIcon color={color} /> }} />
      <Tabs.Screen name="body" options={{ title: 'Организм', tabBarIcon: ({ color }) => <BodyIcon color={color} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', top: -1, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
});
