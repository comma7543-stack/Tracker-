import { Flame, Snowflake } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, View } from 'react-native';
import { useReduceMotion } from '../lib/hooks';
import { flameMotion, flameTier } from '../lib/streak';
import { DARK, flamePalette, useTheme } from '../lib/theme';
import { useFlicker } from './PowerDial';

const SPARKS_AT_TIER = [0, 0, 0, 2, 3, 5];
const SPARKS_MIN_SIZE = 28;

/** An ember rising off the flame and fading out. */
function Spark({ i, size, color }: { i: number; size: number; color: string }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(i * 230),
      Animated.timing(rise, { toValue: 1, duration: 900 + i * 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [rise, i]);
  const drift = (i % 2 ? 1 : -1) * size * (0.08 + i * 0.04);
  return (
    <Animated.View
      style={{
        position: 'absolute', top: size * 0.25, left: size * (0.3 + i * 0.09),
        width: 3, height: 3, borderRadius: 2, backgroundColor: color,
        opacity: rise.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
        transform: [
          { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.6] }) },
          { translateX: rise.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
        ],
      }}
    />
  );
}

/** The streak as a burning fire: bigger, faster and brighter the longer it runs, blue while frozen. */
export function StreakFlame({ count, frozen = false, size = 24 }: { count: number; frozen?: boolean; size?: number }) {
  const c = useTheme();
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const tier = flameTier(count);
  const { stretch, ms } = flameMotion(tier, frozen);
  const flicker = useFlicker(ms, reduceMotion || tier === 0);
  const inner = useFlicker(Math.round(ms * 0.7), reduceMotion || tier === 0);

  if (tier === 0) return <Flame size={size} color={c.muted} strokeWidth={1.8} />;

  const pal = flamePalette(count, frozen);
  const sparks = frozen || reduceMotion || size < SPARKS_MIN_SIZE ? 0 : SPARKS_AT_TIER[tier];
  const lick = (v: Animated.Value, amount: number, degrees: number) => [
    { scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [1 - amount / 2, 1 + amount] }) },
    { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${-degrees}deg`, `${degrees}deg`] }) },
  ];
  const layer = (scale: number, color: string, v: Animated.Value, amount: number, degrees: number) => (
    <Animated.View style={{ position: 'absolute', bottom: 0, alignSelf: 'center', transform: lick(v, amount, degrees) }}>
      <Flame size={size * scale} color={color} fill={color} strokeWidth={1} />
    </Animated.View>
  );

  return (
    <View
      accessible={frozen}
      accessibilityLabel={frozen ? t('streak.dayFrozen') : undefined}
      importantForAccessibility={frozen ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!frozen}
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      {(tier >= 3 || frozen) && size >= SPARKS_MIN_SIZE ? (
        <Animated.View
          style={{
            position: 'absolute', top: -size * 0.1, left: -size * 0.1, width: size * 1.2, height: size * 1.2, borderRadius: size,
            backgroundColor: pal.mid,
            opacity: flicker.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.28] }),
          }}
        />
      ) : null}
      {layer(1, pal.outer, flicker, stretch, 2)}
      {layer(0.68, pal.mid, inner, stretch * 1.4, 3)}
      {tier >= 2 ? layer(0.38, pal.core, flicker, stretch * 1.8, 4) : null}
      {Array.from({ length: sparks }, (_, i) => <Spark key={i} i={i} size={size} color={pal.core} />)}
      {frozen && size >= SPARKS_MIN_SIZE ? (
        <View style={{ position: 'absolute', right: -3, bottom: -2, padding: 2, borderRadius: 999, backgroundColor: pal.outer }}>
          <Snowflake size={Math.round(size * 0.28)} color={DARK.fg} strokeWidth={2.4} />
        </View>
      ) : null}
    </View>
  );
}
