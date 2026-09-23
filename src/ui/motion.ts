import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Системное «Уменьшение движения». Анимации в приложении идут только по реальным событиям,
 * и при этом переключателе остаются на месте.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}
