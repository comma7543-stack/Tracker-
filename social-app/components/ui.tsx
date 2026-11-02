import { router } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator, Animated, Easing, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput,
  TextInputProps, TextProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { initial } from '../lib/format';
import { useReduceMotion } from '../lib/hooks';
import { boxGlow, DARK, DISABLED, Tokens, useTheme } from '../lib/theme';
import { Image } from 'expo-image';

export function T({ s = 15, w, c, style, ...rest }: TextProps & { s?: number; w?: TextStyle['fontWeight']; c?: string }) {
  const t = useTheme();
  return <Text {...rest} style={[{ fontSize: s, color: c ?? t.fg, fontWeight: w }, style]} />;
}

function NeonPage({ stops }: { stops: string[] }) {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <RadialGradient id="page" cx="50%" cy="-8%" rx="130%" ry="55%">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="0.45" stopColor={stops[1]} />
          <Stop offset="1" stopColor={stops[2]} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#page)" />
    </Svg>
  );
}

export function Screen({ children, style, top = true, bottom = false, dark = false }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; top?: boolean; bottom?: boolean; dark?: boolean;
}) {
  const t = useTheme();
  const inset = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: dark ? DARK.bg : t.bg, paddingTop: top ? inset.top : 0, paddingBottom: bottom ? inset.bottom : 0 }, style]}>
      {!dark && t.pageGradient ? <NeonPage stops={t.pageGradient} /> : null}
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: 18, overflow: 'hidden', backgroundColor: t.surface, borderWidth: t.cardBorderWidth, borderColor: t.cardBorderColor }, style]}>
      {t.cardGradient ? (
        <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="card" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={t.cardGradient[0]} />
              <Stop offset="1" stopColor={t.cardGradient[1]} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#card)" />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

export function Button({ label, onPress, disabled, busy, auth, kind = 'primary', style }: {
  label: string; onPress?: () => void; disabled?: boolean; busy?: boolean; auth?: boolean; kind?: 'primary' | 'secondary'; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const off = disabled || busy;
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: auth ? 46 : 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10,
          backgroundColor: primary ? (off ? DISABLED : pressed ? t.accentPressed : t.accent) : t.bg,
          borderWidth: primary ? 0 : 1, borderColor: t.line,
        },
        primary && !off ? boxGlow(t) : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? t.onAccent : t.fg} /> : <T s={15} w="600" c={primary ? t.onAccent : t.fg}>{label}</T>}
    </Pressable>
  );
}

export function Input({ style, ...rest }: TextInputProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...rest}
      onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
      style={[{
        height: 52, borderWidth: 1, borderColor: focused ? t.fg : t.line, borderRadius: 12, backgroundColor: t.surface,
        paddingHorizontal: 14, fontSize: 16, color: t.fg,
      }, style]}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <T s={12} c={t.muted} style={{ marginBottom: 6 }}>{children}</T>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <T s={13} c={t.danger} accessibilityRole="alert" style={{ marginTop: 8, lineHeight: 18 }}>{children}</T>;
}

export function Logo({ size = 88 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.27, borderWidth: 2, borderColor: t.fg, alignItems: 'center', justifyContent: 'center' }}>
      <T s={size > 70 ? 12 : 10} w="700" style={{ letterSpacing: 1 }}>LOGO</T>
    </View>
  );
}

export function IconButton({ label, onPress, children, style }: { label: string; onPress?: () => void; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, style]}>
      {children}
    </Pressable>
  );
}

export function BackHeader({ title, right, onBack }: { title?: string; right?: ReactNode; onBack?: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderBottomWidth: title ? 1 : 0, borderBottomColor: t.line }}>
      <IconButton label={tr('common.back')} onPress={onBack ?? (() => router.back())}><ChevronLeft size={24} color={t.fg} strokeWidth={2} /></IconButton>
      {title ? <T s={18} w="700" numberOfLines={1} style={{ flex: 1 }}>{title}</T> : <View style={{ flex: 1 }} />}
      {right}
    </View>
  );
}

export function AuthScreen({ children, back = true, onBack }: { children: ReactNode; back?: boolean; onBack?: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 }}>
          <View style={{ height: 56, justifyContent: 'center' }}>
            {back ? (
              <IconButton label={tr('common.back')} onPress={onBack ?? (() => router.back())} style={{ marginLeft: -10 }}>
                <ChevronLeft size={24} color={t.fg} strokeWidth={2} />
              </IconButton>
            ) : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <T s={24} w="700" accessibilityRole="header" style={{ lineHeight: 30, marginVertical: 8 }}>{children}</T>;
}

export function Sub({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <T s={15} c={t.muted} style={[{ lineHeight: 21, marginBottom: 20 }, style]}>{children}</T>;
}

export function Avatar({ name, url, size = 36, bg, fg }: { name?: string | null; url?: string | null; size?: number; bg?: string; fg?: string }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? t.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {url ? <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" /> : <T s={size * 0.4} w="700" c={fg}>{initial(name)}</T>}
    </View>
  );
}

export function Pill({ label, primary, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 32, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: primary ? c.accent : c.surface2 }}>
      <T s={13} w="600" c={primary ? c.onAccent : c.fg}>{label}</T>
    </Pressable>
  );
}

/** The answers from the commitment questions. */
export function GoalCard({ goal, dedication }: { goal: string; dedication: number | null }) {
  const c = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.line }}>
      <View style={{ gap: 2 }}>
        <T s={12} c={c.muted}>{t('commit.goalLabel')}</T>
        <T s={15} w="600">{goal}</T>
      </View>
      {dedication !== null ? (
        <View style={{ gap: 2 }}>
          <T s={12} c={c.muted}>{t('commit.dedication')}</T>
          <T s={15} w="600">{t('commit.dedicationValue', { n: dedication })}</T>
        </View>
      ) : null}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={[{
        height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, justifyContent: 'center',
        backgroundColor: on ? t.selected : t.bg, borderColor: on ? t.selected : t.line,
      }, on ? boxGlow(t) : null]}
    >
      <T s={13} w="600" c={on ? t.onSelected : t.fg}>{label}</T>
    </Pressable>
  );
}

// Lists glide farther on a flick than the platform default, which is 0.998 on iOS and 0.985 on Android.
export const FAST_SCROLL = { decelerationRate: Platform.OS === 'ios' ? 0.999 : 0.995 };

export function Switch({ on, label, onPress }: { on: boolean; label: string; onPress?: () => void }) {
  const t = useTheme();
  const reduce = useReduceMotion();
  const pos = useRef(new Animated.Value(on ? 1 : 0)).current;
  const stretch = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reduce) {
      pos.setValue(on ? 1 : 0);
      return;
    }
    // Color can't use the native driver, and these share a value, so all of it runs in JS.
    Animated.parallel([
      Animated.spring(pos, { toValue: on ? 1 : 0, friction: 5, tension: 140, useNativeDriver: false }),
      Animated.sequence([
        Animated.timing(stretch, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(stretch, { toValue: 0, duration: 180, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    ]).start();
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  const blend = (off: string, onColor: string) => pos.interpolate({ inputRange: [0, 1], outputRange: [off, onColor], extrapolate: 'clamp' });
  const content = (
    <Animated.View style={[{ width: 50, height: 30, borderRadius: 999, backgroundColor: blend(t.faint, t.accent) }, on ? boxGlow(t) : null]}>
      <Animated.View
        style={{
          position: 'absolute', top: 3, left: 3, width: 24, height: 24, borderRadius: 12,
          backgroundColor: blend(t.bg, t.onAccent),
          transform: [
            { translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) },
            { scaleX: stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) },
            { scaleY: stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }) },
          ],
        }}
      />
    </Animated.View>
  );
  if (!onPress) return content;
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={onPress}>{content}</Pressable>;
}

export function Spinner({ color }: { color?: string }) {
  const t = useTheme();
  return <ActivityIndicator size="large" color={color ?? t.fg} />;
}

export function Empty({ text, children }: { text: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 32 }}>
      <T s={14} c={t.muted} style={{ textAlign: 'center', lineHeight: 20 }}>{text}</T>
      {children}
    </View>
  );
}

/** How much of the screen the keyboard covers. iOS only: Android resizes the window itself. */
function useKeyboardHeight() {
  const reduce = useReduceMotion();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const move = (to: number, duration: number) => {
      if (!reduce) LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types.keyboard } });
      setHeight(to);
    };
    const show = Keyboard.addListener('keyboardWillShow', (e) => move(e.endCoordinates.height, e.duration));
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration));
    return () => { show.remove(); hide.remove(); };
  }, [reduce]);
  return height;
}

export function SheetFrame({ title, onClose, children, height, tokens }: {
  title?: string; onClose: () => void; children: ReactNode; height?: number; tokens?: Tokens;
}) {
  const theme = useTheme();
  const t = tokens ?? theme;
  const { t: tr } = useTranslation();
  const reduce = useReduceMotion();
  const inset = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  return (
    <Modal transparent visible animationType={reduce ? 'none' : 'slide'} onRequestClose={onClose}>
      {/* The top padding keeps the sheet below the status bar when the keyboard makes it grow. */}
      <View style={{ flex: 1, backgroundColor: DARK.backdrop, paddingTop: inset.top + 8 }}>
        <Pressable accessibilityLabel={tr('common.close')} onPress={onClose} style={{ flex: 1 }} />
        {/* Runs down behind the keyboard and pads its content up, so nothing shows between them. */}
        <View accessibilityViewIsModal style={{ height: height && keyboard ? height + keyboard : height, maxHeight: keyboard ? '100%' : '90%', backgroundColor: t.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: keyboard ? keyboard + 8 : Math.max(inset.bottom, 12) }}>
          <View style={{ height: 52, alignItems: 'center', justifyContent: 'center', borderBottomWidth: title ? 1 : 0, borderBottomColor: t.line }}>
            <View style={{ position: 'absolute', top: 6, width: 36, height: 4, borderRadius: 2, backgroundColor: t.line }} />
            {title ? <T s={16} w="700">{title}</T> : null}
            <IconButton label={tr('common.close')} onPress={onClose} style={{ position: 'absolute', right: 4, top: 4 }}><X size={22} color={t.fg} strokeWidth={2} /></IconButton>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
