import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from './theme';

/** Плашка «Данные актуальны» на две секунды. */
export function FreshBadge({ onDone }: { onDone: () => void }) {
  const opacity = useSharedValue(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 300 });
      setTimeout(onDone, 300);
    }, 1700);
    return () => clearTimeout(timer);
  }, [onDone, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.fresh, { top: insets.top + 8 }, style]} pointerEvents="none">
      <Text style={styles.freshText}>Данные актуальны</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fresh: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  freshText: { color: colors.textMuted, fontSize: 13 },
});
