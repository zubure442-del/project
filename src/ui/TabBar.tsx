import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Logo } from './Logo';
import { CENTER_SIZE, TAB_ICON_SIZE, TAB_ICON_TOP, TAB_LABEL_LINE, TAB_LABEL_SIZE, tabBarLayout } from './tabBarLayout';
import { colors } from './theme';

/** Маршрут центральной кнопки «Сегодня». */
const CENTER_ROUTE = 'index';

/**
 * Нижняя панель со своей разметкой: круг «Сегодня» приподнят и всегда стоит
 * выше подписи на CENTER_LABEL_GAP, подпись не обрезается. Числа — в tabBarLayout.ts.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  // Ширина экрана на вертикальную разметку не влияет: считаем только высоты.
  const layout = tabBarLayout(0, insets.bottom);
  return (
    <View style={[styles.bar, { height: layout.barHeight }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? colors.accent : colors.textFaint;
        const title = options.title ?? route.name;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={title}
          >
            {route.name === CENTER_ROUTE ? (
              // Статичный знак V в оранжевом круге.
              <View style={[styles.slot, { top: layout.circleTop }]}>
                <View style={styles.circle}>
                  <Logo size={28} color={colors.bg} />
                </View>
              </View>
            ) : (
              <View style={[styles.slot, { top: TAB_ICON_TOP }]}>
                {options.tabBarIcon?.({ focused, color, size: TAB_ICON_SIZE })}
              </View>
            )}
            <Text
              style={[styles.label, { top: layout.labelTop, color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#101017',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.track,
  },
  item: { flex: 1, height: '100%' },
  slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  circle: {
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    left: 2,
    right: 2,
    textAlign: 'center',
    fontSize: TAB_LABEL_SIZE,
    lineHeight: TAB_LABEL_LINE,
  },
});
