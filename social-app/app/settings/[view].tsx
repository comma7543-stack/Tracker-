import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Avatar, BackHeader, Button, ErrorText, FAST_SCROLL, Input, Screen, Switch, T } from '../../components/ui';
import { accountStatus, blockedList, deleteAccount, unblock } from '../../lib/api';
import { APP_VERSION, APP_NAME, PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '../../lib/config';
import { useMyStreak, usePasswordForm, useReduceMotion, useUpdateSettings } from '../../lib/hooks';
import { applyLanguage, LANGUAGES } from '../../lib/i18n';
import { Choices, Prefs, toast, useSettings, useUI } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { boxGlow, useTheme } from '../../lib/theme';

type Item =
  | { kind: 'link'; label: string; sub?: string; value?: string; to: string }
  | { kind: 'toggle'; label: string; sub?: string; pref: keyof Prefs }
  | { kind: 'radio'; label: string; sub?: string; choice: keyof Choices; val: string; after?: () => void }
  | { kind: 'info'; label: string; sub?: string; value?: string }
  | { kind: 'action'; label: string; sub?: string; danger?: boolean; act: () => void };
type Section = { title?: string; note?: string; items: Item[] };
type View_ = { title: string; sections: Section[] };

/** The dot pops in when a choice is picked. */
function RadioDot() {
  const c = useTheme();
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (!reduce) Animated.spring(scale, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }).start();
  }, [scale, reduce]);
  return <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.fg, transform: [{ scale }] }} />;
}

function Row({ item, navigate }: { item: Item; navigate: (to: string) => void }) {
  const c = useTheme();
  const { prefs, choices } = useSettings();
  const { setPref, setChoice } = useUpdateSettings();
  const qc = useQueryClient();

  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T s={15} c={item.kind === 'action' && item.danger ? c.danger : c.fg}>{item.label}</T>
        {item.sub ? <T s={12} c={c.muted} style={{ lineHeight: 16 }}>{item.sub}</T> : null}
      </View>
      {'value' in item && item.value ? <T s={14} c={c.muted} numberOfLines={1} style={{ maxWidth: 140 }}>{item.value}</T> : null}
      {item.kind === 'link' ? <ChevronRight size={18} color={c.muted} strokeWidth={2} /> : null}
      {item.kind === 'toggle' ? <Switch on={prefs[item.pref]} label={item.label} /> : null}
      {item.kind === 'radio' ? (
        <View style={[{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: choices[item.choice] === item.val ? c.fg : c.faint, alignItems: 'center', justifyContent: 'center' }, choices[item.choice] === item.val ? boxGlow(c) : null]}>
          {choices[item.choice] === item.val ? <RadioDot /> : null}
        </View>
      ) : null}
    </>
  );

  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, minHeight: 54, paddingVertical: 8, paddingHorizontal: 14 };
  if (item.kind === 'info') return <View style={style}>{body}</View>;

  const press = () => {
    if (item.kind === 'link') navigate(item.to);
    if (item.kind === 'action') item.act();
    if (item.kind === 'toggle') {
      setPref(item.pref, !prefs[item.pref]);
      if (item.pref === 'isPrivate') setTimeout(() => qc.invalidateQueries({ queryKey: ['me'] }), 500);
    }
    if (item.kind === 'radio') {
      setChoice(item.choice, item.val);
      item.after?.();
    }
  };

  const role = item.kind === 'toggle' ? 'switch' : item.kind === 'radio' ? 'radio' : 'button';
  const checked = item.kind === 'toggle' ? prefs[item.pref] : item.kind === 'radio' ? choices[item.choice] === item.val : undefined;
  return (
    <Pressable accessibilityRole={role} accessibilityState={checked === undefined ? undefined : { checked }} onPress={press} style={({ pressed }) => [style, pressed ? { backgroundColor: c.surface2 } : null]}>
      {body}
    </Pressable>
  );
}

function SectionView({ section, navigate }: { section: Section; navigate: (to: string) => void }) {
  const c = useTheme();
  return (
    <View>
      {section.title ? <T s={13} w="600" c={c.muted} style={{ paddingTop: 20, paddingHorizontal: 28, paddingBottom: 8 }}>{section.title}</T> : null}
      {section.note ? <T s={13} c={c.muted} style={{ paddingTop: 16, paddingHorizontal: 28, paddingBottom: 10, lineHeight: 18 }}>{section.note}</T> : null}
      {section.items.length > 0 ? (
        <View style={{ marginHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {section.items.map((item, i) => (
            <View key={item.label} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.line }}>
              <Row item={item} navigate={navigate} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BlockedView() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['blocked'], queryFn: blockedList });
  if (data.length === 0) return <T s={13} c={c.muted} style={{ padding: 28, lineHeight: 18 }}>{t('settings.noBlocked')}</T>;
  return (
    <View style={{ marginTop: 16 }}>
      {data.map((u) => (
        <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16 }}>
          <Avatar name={u.username} url={u.avatar_url} size={40} />
          <T s={14} w="600" style={{ flex: 1 }} numberOfLines={1}>{u.username}</T>
          <Button kind="secondary" label={t('settings.unblock')} style={{ paddingHorizontal: 16 }} onPress={() => unblock(u.id).then(() => qc.invalidateQueries())} />
        </View>
      ))}
    </View>
  );
}

function ChangePasswordView() {
  const c = useTheme();
  const { t } = useTranslation();
  const { pw, setPw, busy, error, save: savePassword } = usePasswordForm();
  const save = () => savePassword(() => {
    toast(t('settings.passwordChanged'));
    router.back();
  });
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <T s={14} c={c.muted}>{t('auth.passwordRule')}</T>
      <Input accessibilityLabel={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" placeholder={t('auth.password')} />
      {pw.length > 0 && pw.length < 8 ? <T s={13} c={c.muted}>{t('auth.moreChars', { count: 8 - pw.length })}</T> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={t('common.save')} disabled={pw.length < 8} busy={busy} onPress={save} />
    </View>
  );
}

export default function Settings() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { view = 'main' } = useLocalSearchParams<{ view: string }>();
  const open = useUI((s) => s.open);
  const { prefs, choices } = useSettings();
  const streak = useMyStreak();
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: accountStatus });
  const { data: blocked = [] } = useQuery({ queryKey: ['blocked'], queryFn: blockedList });
  const [q, setQ] = useState('');

  const navigate = (to: string) => router.push(`/settings/${to}`);
  const choice = (v: string) => t(`choice.${v}`);
  const toggle = (pref: keyof Prefs, label: string, sub?: string): Item => ({ kind: 'toggle', pref, label, sub });
  const radios = (key: keyof Choices, vals: string[]): Item[] => vals.map((val) => ({ kind: 'radio', choice: key, val, label: choice(val) }));
  const info = (label: string, sub?: string): Item => ({ kind: 'info', label, sub });
  const freezes = streak?.freezes_available ?? 0;
  const strikes = status?.strikes ?? 0;

  const logOut = async () => {
    await supabase.auth.signOut();
    qc.clear();
  };

  const confirmDelete = () => {
    Alert.alert(t('settings.deleteForever'), t('settings.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAccount();
            qc.clear();
          } catch {
            toast(t('common.tryAgain'));
          }
        },
      },
    ]);
  };

  const views: Record<string, View_> = {
    main: { title: t('settings.title'), sections: [
      { title: t('settings.yourStreak'), items: [
        { kind: 'link', label: t('settings.reminders'), to: 'reminders', value: prefs.streakRemind ? choice(choices.reminderTime) : choice('Off') },
        { kind: 'link', label: t('settings.freeze'), to: 'freeze', value: t('settings.available', { count: freezes }) },
        { kind: 'link', label: t('settings.whoStreak'), to: 'streakwho', value: choice(choices.streakWho) },
      ] },
      { title: t('settings.notifications'), items: [
        toggle('pauseAll', t('settings.pauseAll')),
        toggle('nLikes', t('settings.likesComments')),
        toggle('nFollows', t('settings.newFollowers')),
        toggle('nDms', t('settings.messages')),
      ] },
      { title: t('settings.privacy'), items: [
        toggle('isPrivate', t('settings.private'), t('settings.privateSub')),
        toggle('showLists', t('settings.showLists'), t('settings.showListsSub')),
        { kind: 'link', label: t('settings.whoMessage'), to: 'messages', value: choice(choices.dmWho) },
        { kind: 'link', label: t('settings.whoComment'), to: 'comments', value: choice(choices.commentWho) },
        { kind: 'link', label: t('settings.blocked'), to: 'blocked', value: String(blocked.length) },
      ] },
      { title: t('settings.app'), items: [
        { kind: 'link', label: t('settings.theme'), to: 'theme', value: t(`settings.theme_${choices.theme}`) },
        { kind: 'link', label: t('settings.language'), to: 'language', value: LANGUAGES.find((l) => l[0] === choices.lang)?.[1] ?? '' },
        { kind: 'link', label: t('settings.timeLimit'), to: 'timelimit', value: choice(choices.timeLimit) },
        toggle('reduceMotion', t('settings.reduceMotion'), t('settings.reduceMotionSub')),
        toggle('autoplayWifi', t('settings.autoplayWifi')),
        toggle('dataSaver', t('settings.dataSaver'), t('settings.dataSaverSub')),
      ] },
      { title: t('settings.account'), items: [
        { kind: 'link', label: t('settings.status'), to: 'status', value: status?.suspended ? t('settings.suspended') : strikes ? t('settings.strikesOf', { n: strikes }) : t('settings.goodStanding') },
        { kind: 'action', label: t('profile.edit'), act: () => router.push('/edit-profile') },
        { kind: 'link', label: t('settings.changePassword'), to: 'password' },
        { kind: 'link', label: t('settings.help'), to: 'help' },
        { kind: 'action', label: t('settings.logOut'), act: logOut },
        { kind: 'link', label: t('settings.delete'), to: 'delete' },
      ] },
    ] },
    reminders: { title: t('settings.reminders'), sections: [
      { items: [toggle('streakRemind', t('settings.remindMe'), t('settings.remindSub'))] },
      { title: t('settings.remindAt'), items: radios('reminderTime', ['6 PM', '9 PM', '11 PM']) },
    ] },
    freeze: { title: t('settings.freeze'), sections: [
      { note: t('settings.freezeNote'), items: [
        { kind: 'info', label: t('settings.freezesAvailable'), value: String(freezes) },
        toggle('autoFreeze', t('settings.autoFreeze'), t('settings.autoFreezeSub')),
      ] },
    ] },
    streakwho: { title: t('settings.whoStreak'), sections: [{ items: radios('streakWho', ['Everyone', 'Followers', 'Only me']) }] },
    messages: { title: t('settings.whoMessage'), sections: [{ items: radios('dmWho', ['Everyone', 'People you follow', 'No one']) }] },
    comments: { title: t('settings.whoComment'), sections: [
      { items: radios('commentWho', ['Everyone', 'People you follow', 'Off']) },
      { items: [toggle('hideOffensive', t('settings.hideOffensive'))] },
    ] },
    blocked: { title: t('settings.blocked'), sections: [] },
    theme: { title: t('settings.theme'), sections: [
      { note: t('settings.themeNote'), items: [
        { kind: 'radio', choice: 'theme', val: 'white', label: t('settings.theme_white'), sub: t('settings.themeWhiteSub') },
        { kind: 'radio', choice: 'theme', val: 'neon', label: t('settings.theme_neon'), sub: t('settings.themeNeonSub') },
        { kind: 'radio', choice: 'theme', val: 'color', label: t('settings.theme_color'), sub: t('settings.themeColorSub') },
      ] },
    ] },
    language: { title: t('settings.language'), sections: [
      { items: LANGUAGES.map(([code, name, english]) => ({
        kind: 'radio' as const, choice: 'lang' as const, val: code, label: name, sub: english,
        after: () => toast(applyLanguage(code) ? t('settings.restartForLanguage') : t('settings.languageSet', { name })),
      })) },
    ] },
    timelimit: { title: t('settings.timeLimit'), sections: [
      { note: t('settings.timeLimitNote', { app: APP_NAME }), items: radios('timeLimit', ['Off', '15 min', '30 min', '1 hour', '2 hours']) },
    ] },
    password: { title: t('settings.changePassword'), sections: [] },
    help: { title: t('settings.help'), sections: [
      { items: [
        { kind: 'link', label: t('settings.guidelines'), to: 'guidelines' },
        { kind: 'action', label: t('report.problem'), act: () => open({ type: 'report', target: { type: 'problem', id: null } }) },
        { kind: 'info', label: t('settings.support'), value: SUPPORT_EMAIL },
        { kind: 'info', label: t('settings.terms'), value: TERMS_URL },
        { kind: 'info', label: t('settings.privacyPolicy'), value: PRIVACY_URL },
        { kind: 'info', label: t('settings.version'), value: APP_VERSION },
      ] },
    ] },
    status: { title: t('settings.status'), sections: [
      { note: t('settings.statusNote'), items: [
        { kind: 'info', label: t('settings.strikes'), value: t('settings.strikesOf', { n: Math.min(strikes, 3) }) },
        { kind: 'info', label: t('settings.posting'), value: status?.suspended ? t('settings.postingSuspended') : t('settings.postingAllowed') },
        { kind: 'info', label: t('settings.reviews'), value: String(status?.reviews_requested ?? 0) },
      ] },
      { items: [{ kind: 'link', label: t('settings.guidelines'), to: 'guidelines' }] },
    ] },
    guidelines: { title: t('settings.guidelines'), sections: [
      { title: t('guidelines.canPost'), note: t('guidelines.canPostNote'), items: [
        info(t('topic.Fitness'), t('guidelines.fitness')),
        info(t('topic.Learning'), t('guidelines.learning')),
        info(t('topic.Work and tech'), t('guidelines.work')),
        info(t('topic.Money and health'), t('guidelines.money')),
        info(t('topic.Motivation'), t('guidelines.motivation')),
      ] },
      { title: t('guidelines.never'), items: [
        info(t('guidelines.sexual'), t('guidelines.sexualSub')),
        info(t('guidelines.illegal'), t('guidelines.illegalSub')),
        info(t('guidelines.violence'), t('guidelines.violenceSub')),
        info(t('guidelines.hate'), t('guidelines.hateSub')),
        info(t('guidelines.scams'), t('guidelines.scamsSub')),
        info(t('guidelines.alcohol')),
      ] },
      { title: t('guidelines.happens'), note: t('guidelines.reviewNote'), items: [
        info(t('guidelines.offTopic'), t('guidelines.offTopicSub')),
        info(t('guidelines.breaks'), t('guidelines.breaksSub')),
        info(t('guidelines.zero'), t('guidelines.zeroSub')),
      ] },
    ] },
    delete: { title: t('settings.delete'), sections: [
      { note: t('settings.deleteBody'), items: [
        { kind: 'action', label: t('settings.deleteForever'), danger: true, act: confirmDelete },
        { kind: 'action', label: t('common.cancel'), act: () => router.back() },
      ] },
    ] },
  };

  const current = views[view] ?? views.main;
  const search = q.trim().toLowerCase();
  let sections = current.sections;

  if (view === 'main' && search) {
    const hits = new Map<string, Item>();
    for (const [key, v] of Object.entries(views)) {
      if (key === 'delete') continue;
      for (const s of v.sections) for (const item of s.items) {
        if (item.label.toLowerCase().includes(search) && !hits.has(item.label)) hits.set(item.label, item);
      }
    }
    sections = hits.size > 0 ? [{ title: t('settings.results'), items: [...hits.values()] }] : [];
  }

  return (
    <Screen>
      <BackHeader title={current.title} />
      <ScrollView {...FAST_SCROLL} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
        {view === 'main' ? (
          <View style={{ paddingTop: 12, paddingHorizontal: 16, justifyContent: 'center' }}>
            <TextInput
              accessibilityLabel={t('settings.search')}
              value={q}
              onChangeText={setQ}
              placeholder={t('settings.search')}
              placeholderTextColor={c.muted}
              autoCorrect={false}
              style={{ height: 44, borderRadius: 10, backgroundColor: c.surface2, paddingLeft: 36, paddingRight: 12, fontSize: 15, color: c.fg }}
            />
            <View pointerEvents="none" style={{ position: 'absolute', left: 28, top: 25 }}><Search size={18} color={c.muted} strokeWidth={2} /></View>
          </View>
        ) : null}
        {sections.map((s, i) => <SectionView key={s.title ?? i} section={s} navigate={navigate} />)}
        {view === 'blocked' ? <BlockedView /> : null}
        {view === 'password' ? <ChangePasswordView /> : null}
        {view === 'main' && search && sections.length === 0 ? <T s={14} c={c.muted} style={{ margin: 32, textAlign: 'center' }}>{t('settings.noMatch')}</T> : null}
      </ScrollView>
    </Screen>
  );
}
