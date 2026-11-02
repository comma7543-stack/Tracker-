import { Flame } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityActionEvent, Animated, Easing, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { DIAL_MAX, flickerFor, fractionOfLevel, levelFromFraction } from '../lib/dial';
import { useReduceMotion } from '../lib/hooks';
import { DARK, FIRE, useTheme } from '../lib/theme';
import { T } from './ui';

const FLAME_SIZE = 190;

/** A value swinging 0 to 1 and back forever, until the level or the motion setting changes. */
export function useFlicker(ms: number, off: boolean) {
  const flicker = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (off) {
      flicker.setValue(0);
      return undefined;
    }
    const swing = (toValue: number) => Animated.timing(flicker, { toValue, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([swing(1), swing(0)]));
    loop.start();
    return () => loop.stop();
  }, [flicker, ms, off]);
  return flicker;
}

/** Three flames stacked: a spark at level 1, a full fire with a bright core by level 10. */
function FlameStack({ level }: { level: number }) {
  const reduceMotion = useReduceMotion();
  const { stretch, ms } = flickerFor(level);
  const flicker = useFlicker(ms, reduceMotion);
  const power = useRef(new Animated.Value(level)).current;

  useEffect(() => {
    if (reduceMotion) power.setValue(level);
    else Animated.spring(power, { toValue: level, friction: 4, tension: 120, useNativeDriver: true }).start();
  }, [power, level, reduceMotion]);

  const fade = (from: number, to: number) => power.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' });
  const layer = (size: number, color: string, opacity: Animated.AnimatedInterpolation<number> | number) => (
    <Animated.View style={{ position: 'absolute', bottom: 0, alignSelf: 'center', opacity }}>
      <Flame size={size} color={color} fill={color} strokeWidth={1} />
    </Animated.View>
  );

  return (
    <Animated.View style={{ width: FLAME_SIZE, height: FLAME_SIZE, transform: [{ scale: power.interpolate({ inputRange: [1, DIAL_MAX], outputRange: [0.3, 1.5] }) }] }}>
      <Animated.View style={{ flex: 1, transform: [
        { scaleY: flicker.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + stretch] }) },
        { rotate: flicker.interpolate({ inputRange: [0, 1], outputRange: ['-1.5deg', '1.5deg'] }) },
      ] }}>
        {layer(FLAME_SIZE, FIRE.outer, 1)}
        {layer(FLAME_SIZE * 0.68, FIRE.mid, fade(2, 4))}
        {layer(FLAME_SIZE * 0.38, FIRE.core, fade(5, 7))}
      </Animated.View>
    </Animated.View>
  );
}

function Meter({ level, onChange, hot }: { level: number; onChange: (level: number) => void; hot: boolean }) {
  const c = useTheme();
  const { t } = useTranslation();
  const height = useRef(1);
  const start = useRef(0);
  // The responder is made once, so it reads the latest callback through this.
  const change = useRef(onChange);
  change.current = onChange;

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      start.current = 1 - e.nativeEvent.locationY / height.current;
      change.current(levelFromFraction(start.current));
    },
    onPanResponderMove: (_e, g) => change.current(levelFromFraction(start.current - g.dy / height.current)),
  })).current;

  const onAction = (e: AccessibilityActionEvent) => {
    const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
    onChange(levelFromFraction(fractionOfLevel(level + step)));
  };

  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('commit.dialLabel')}
      accessibilityValue={{ min: 1, max: DIAL_MAX, now: level }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      onLayout={(e) => { height.current = Math.max(1, e.nativeEvent.layout.height); }}
      style={{ width: 72, alignSelf: 'stretch', paddingHorizontal: 10 }}
    >
      {/* Children don't take touches, so the position is always measured against the whole meter. */}
      <View pointerEvents="none" style={{ flex: 1, flexDirection: 'column-reverse', gap: 5 }}>
        {Array.from({ length: DIAL_MAX }, (_, i) => (
          <View key={i} style={{ flex: 1, borderRadius: 6, backgroundColor: i < level ? FIRE.levels[i] : hot ? DARK.chip : c.surface2 }} />
        ))}
      </View>
    </View>
  );
}

export function PowerDial({ level, onChange, hot }: { level: number; onChange: (level: number) => void; hot: boolean }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 240 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}>
        <FlameStack level={level} />
        <T s={88} w="800" c={hot ? DARK.fg : undefined} accessibilityElementsHidden style={{ position: 'absolute', bottom: 0, lineHeight: 96 }}>{level}</T>
      </View>
      <Meter level={level} onChange={onChange} hot={hot} />
    </View>
  );
}

/** The screen catching fire at level 10: a hot glow and a wall of flames along the bottom. */
export function FireBackdrop({ on }: { on: boolean }) {
  const reduceMotion = useReduceMotion();
  const shown = useRef(new Animated.Value(0)).current;
  const flicker = useFlicker(180, reduceMotion || !on);

  useEffect(() => {
    Animated.timing(shown, { toValue: on ? 1 : 0, duration: reduceMotion ? 0 : on ? 700 : 300, useNativeDriver: true }).start();
  }, [shown, on, reduceMotion]);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: shown }]}>
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="fire" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={FIRE.skyTop} />
            <Stop offset="0.55" stopColor={FIRE.skyMid} />
            <Stop offset="1" stopColor={FIRE.outer} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fire)" />
      </Svg>
      <View style={{ position: 'absolute', bottom: -50, left: -50, right: -50, flexDirection: 'row', justifyContent: 'space-between' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Animated.View key={i} style={{ transform: [{ scaleY: flicker.interpolate({ inputRange: [0, 1], outputRange: i % 2 ? [1.15, 0.9] : [0.9, 1.15] }) }] }}>
            <Flame size={i % 2 ? 170 : 130} color={i % 2 ? FIRE.mid : FIRE.core} fill={i % 2 ? FIRE.mid : FIRE.core} strokeWidth={1} />
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}
