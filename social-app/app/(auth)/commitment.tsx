import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { FireBackdrop, PowerDial } from '../../components/PowerDial';
import { AuthScreen, Button, ErrorText, GoalCard, H1, IconButton, Input, Label, Screen, Sub, T } from '../../components/ui';
import { HELP_LINE } from '../../lib/config';
import { DARE_AT, DIAL_MAX } from '../../lib/dial';
import { goalConcern, goalTooVague } from '../../lib/goalCheck';
import { useReduceMotion } from '../../lib/hooks';
import { isBad } from '../../lib/profanity';
import { useCommitment } from '../../lib/store';
import { DARK, useTheme } from '../../lib/theme';

const STEPS = ['goal', 'hardest', 'excuse', 'badDay', 'compare', 'nobody', 'dare', 'dial', 'process'] as const;
type Step = (typeof STEPS)[number];

// Each tap gets its own reply. The picks are only for fun, so they aren't saved.
const CHOICES: Partial<Record<Step, string[]>> = {
  hardest: ['starting', 'staying', 'believing'],
  excuse: ['monday', 'tired', 'time', 'none'],
  badDay: ['again', 'learn', 'rest', 'quit'],
  compare: ['own', 'ask', 'bothered'],
  nobody: ['yes', 'some', 'seen'],
  dare: ['deal', 'miss'],
};

const FADE_OUT_MS = 350;
const REVEAL_MS = 700;
// The pause between lines, so each one gets read before the next arrives.
const LINE_MS = 500;
const OPTION_MS = 150;
const PROCESS_LINE_MS = 1800;

/** Fades and rises into place after `delay`. Remounts with each step, so it replays. */
function Reveal({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      shown.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(shown, { toValue: 1, delay, duration: REVEAL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [shown, delay, reduceMotion]);
  const rise = shown.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  return <Animated.View style={[style, { opacity: shown, transform: [{ translateY: rise }] }]}>{children}</Animated.View>;
}

function Progress({ index, hot }: { index: number; hot?: boolean }) {
  const c = useTheme();
  const done = hot ? DARK.fg : c.fg;
  const todo = hot ? DARK.chip : c.line;
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 24 }}>
      {STEPS.map((step, i) => <View key={step} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= index ? done : todo }} />)}
    </View>
  );
}

function Option({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? c.selected : c.line, backgroundColor: on ? c.selected : c.bg }}
    >
      <T s={16} w="600" c={on ? c.onSelected : c.fg}>{label}</T>
    </Pressable>
  );
}

// Shown once per device, before log in and sign up. Any answer moves on: this dares
// people to commit, it doesn't test them. Sign-up copies the goal to the profile.
export default function Commitment() {
  const c = useTheme();
  const { t } = useTranslation();
  const finish = useCommitment((s) => s.finish);
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const [goal, setGoal] = useState('');
  const [care, setCare] = useState(false);
  const [picks, setPicks] = useState<Partial<Record<Step, string>>>({});
  const [level, setLevel] = useState(1);
  const [dared, setDared] = useState(false);
  const leaving = useRef(new Animated.Value(1)).current;
  const moving = useRef(false);
  const step = STEPS[index];

  // Fades this question out before the next appears. The guard stops a second tap skipping one.
  const moveTo = (nextIndex: number) => {
    if (moving.current) return;
    moving.current = true;
    Animated.timing(leaving, { toValue: 0, duration: reduceMotion ? 0 : FADE_OUT_MS, useNativeDriver: true }).start(() => {
      setIndex(nextIndex);
      leaving.setValue(1);
      moving.current = false;
    });
  };
  const next = () => moveTo(index + 1);
  const back = index > 0 ? () => moveTo(index - 1) : undefined;

  const page = (children: ReactNode) => (
    <AuthScreen back={index > 0} onBack={back}>
      <Progress index={index} />
      {/* The key replays every Reveal inside when the question changes. */}
      <Animated.View key={step} style={{ opacity: leaving }}>{children}</Animated.View>
    </AuthScreen>
  );

  // No coach voice and no dare here. The goal isn't kept.
  if (care) {
    return (
      <AuthScreen back={false}>
        <Reveal><H1>{t('commit.careTitle')}</H1></Reveal>
        <Reveal delay={LINE_MS}><Sub>{t('commit.careBody')}</Sub></Reveal>
        <Reveal delay={LINE_MS * 2}><Sub>{t('commit.careHelp', { line: HELP_LINE })}</Sub></Reveal>
        <Reveal delay={LINE_MS * 3}>
          <Button auth kind="secondary" label={t('commit.careBack')} onPress={() => { setGoal(''); setCare(false); }} />
        </Reveal>
      </AuthScreen>
    );
  }

  if (step === 'goal') {
    const concern = goalConcern(goal);
    const vague = goalTooVague(goal);
    const bad = isBad(goal) || concern === 'harm' || vague;
    // Nothing to say while the first letter is being typed.
    const message = concern === 'harm' ? t('commit.goalHarm') : isBad(goal) ? t('compose.offensive') : vague && goal.trim().length >= 2 ? t('commit.goalVague') : '';
    return page(
      <>
        <Reveal><H1>{t('commit.goalTitle')}</H1></Reveal>
        <Reveal delay={LINE_MS}><Sub>{t('commit.goalSub')}</Sub></Reveal>
        <Reveal delay={LINE_MS * 2}>
          <Label>{t('commit.goalLabel')}</Label>
          <Input accessibilityLabel={t('commit.goalLabel')} value={goal} onChangeText={setGoal} maxLength={100} placeholder={t('commit.goalPh')} />
          {message ? <ErrorText>{message}</ErrorText> : null}
          <View style={{ height: 24 }} />
          <Button auth label={t('common.next')} disabled={bad && concern !== 'care'} onPress={concern === 'care' ? () => setCare(true) : next} />
        </Reveal>
      </>,
    );
  }

  if (step === 'dial') {
    const hot = level === DIAL_MAX;
    const daring = dared && level <= DARE_AT;
    const light = hot ? DARK.fg : undefined;
    return (
      <Screen bottom style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        <FireBackdrop on={hot} />
        <View style={{ height: 56, justifyContent: 'center' }}>
          <IconButton label={t('common.back')} onPress={back} style={{ marginLeft: -10 }}>
            <ChevronLeft size={24} color={hot ? DARK.fg : c.fg} strokeWidth={2} />
          </IconButton>
        </View>
        <Progress index={index} hot={hot} />
        <Animated.View style={{ flex: 1, opacity: leaving }}>
          <Reveal><T s={24} w="700" c={light} accessibilityRole="header" style={{ lineHeight: 30 }}>{t('commit.dialTitle')}</T></Reveal>
          <Reveal delay={LINE_MS} style={{ flex: 1, marginVertical: 16 }}>
            <PowerDial level={level} onChange={setLevel} hot={hot} />
          </Reveal>
          <Reveal delay={LINE_MS * 2}>
            <T s={18} w="700" c={light} accessibilityLiveRegion="polite" style={{ textAlign: 'center', minHeight: 48, lineHeight: 24 }}>
              {daring ? t('commit.dareLow', { n: level }) : level === 1 ? t('commit.dialHint') : t(`commit.level${level}`)}
            </T>
            {daring ? (
              <View style={{ gap: 10, marginTop: 8 }}>
                <Button auth label={t('commit.goHigher')} onPress={() => setDared(false)} />
                <Button auth kind="secondary" label={t('commit.stayAt', { n: level })} onPress={next} />
              </View>
            ) : (
              <Button auth label={t('commit.lockIn')} onPress={level <= DARE_AT ? () => setDared(true) : next} style={{ marginTop: 8 }} />
            )}
          </Reveal>
        </Animated.View>
      </Screen>
    );
  }

  if (step === 'process') {
    return page(
      <>
        <Reveal><H1>{t('commit.processTitle')}</H1></Reveal>
        <Reveal delay={PROCESS_LINE_MS}><Sub>{t('commit.processResults')}</Sub></Reveal>
        <Reveal delay={PROCESS_LINE_MS * 2}><Sub>{t('commit.processMatters')}</Sub></Reveal>
        <Reveal delay={PROCESS_LINE_MS * 3}>
          <GoalCard goal={goal.trim()} dedication={level} />
          <View style={{ height: 24 }} />
        </Reveal>
        <Reveal delay={PROCESS_LINE_MS * 4}>
          <Button
            auth
            label={t('commit.processDone')}
            onPress={() => {
              finish(goal.trim(), level);
              router.replace('/(auth)/welcome');
            }}
          />
        </Reveal>
      </>,
    );
  }

  const picked = picks[step];
  return page(
    <>
      <Reveal><H1>{t(`commit.${step}Title`)}</H1></Reveal>
      <Reveal delay={LINE_MS}><Sub>{t(`commit.${step}Sub`, { goal: goal.trim() })}</Sub></Reveal>
      <View style={{ gap: 10 }}>
        {CHOICES[step]?.map((choice, i) => (
          <Reveal key={choice} delay={LINE_MS * 2 + OPTION_MS * i}>
            <Option label={t(`commit.${step}_${choice}`)} on={picked === choice} onPress={() => setPicks({ ...picks, [step]: choice })} />
          </Reveal>
        ))}
      </View>
      {picked ? (
        <>
          <Reveal key={picked}>
            <T s={18} w="700" accessibilityLiveRegion="polite" style={{ marginTop: 24, marginBottom: 20, lineHeight: 24 }}>{t(`commit.${step}_${picked}Reply`)}</T>
          </Reveal>
          <Reveal delay={LINE_MS}><Button auth label={t('commit.keepGoing')} onPress={next} /></Reveal>
        </>
      ) : null}
    </>,
  );
}
