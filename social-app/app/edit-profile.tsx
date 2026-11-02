import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, TextInputProps, View } from 'react-native';
import { Avatar, ErrorText, Screen, T } from '../components/ui';
import { goalStatus, updateProfile } from '../lib/api';
import { HELP_LINE } from '../lib/config';
import { goalConcern, goalFixHoursLeft, goalTooVague } from '../lib/goalCheck';
import { useMe, useUsernameCheck } from '../lib/hooks';
import { pickMedia, uploadAvatar } from '../lib/media';
import { isBad } from '../lib/profanity';
import { toast } from '../lib/store';
import { useTheme } from '../lib/theme';
import { normalizeUsername } from '../lib/validation';

function Field({ label, ...rest }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T s={12} w="600" c={c.muted} style={{ letterSpacing: 0.7, textTransform: 'uppercase' }}>{label}</T>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...rest} style={{ height: 44, borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: c.fg, backgroundColor: c.bg }} />
    </View>
  );
}

export default function EditProfile() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe().data;
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [bio, setBio] = useState('');
  const [goalEdit, setGoalEdit] = useState<string | null>(null);
  const { data: saved } = useQuery({ queryKey: ['goal-status'], queryFn: goalStatus });
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useUsernameCheck(user, me?.username);

  useEffect(() => {
    if (!me) return;
    setName(me.full_name);
    setUser(me.username);
    setBio(me.bio);
    setAvatar(me.avatar_url);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameBad = isBad(name);
  const bioBad = isBad(bio);
  const goal = goalEdit ?? saved?.goal ?? '';
  const hoursLeft = goalFixHoursLeft(saved?.set_at);
  const goalLocked = !!saved?.goal && hoursLeft === 0;
  const concern = goalConcern(goal);
  const goalError = concern === 'care' ? `${t('commit.careBody')} ${t('commit.careHelp', { line: HELP_LINE })}`
    : concern === 'harm' ? t('commit.goalHarm')
    : isBad(goal) ? t('compose.offensive')
    : goal.trim() && goalTooVague(goal) ? t('commit.goalVague') : '';
  const canSave = !!name.trim() && !nameBad && !bioBad && !goalError && check.ok && !busy;

  const changePhoto = async () => {
    const picked = await pickMedia('photo');
    if (!picked) return;
    try {
      setAvatar(await uploadAvatar(picked.uri, picked.width));
    } catch {
      toast(t('common.tryAgain'));
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      // Left out until the field is touched, so a slow load can't blank a saved goal.
      await updateProfile({ full_name: name.trim(), username: user, bio: bio.trim(), avatar_url: avatar, ...(goalEdit === null ? {} : { goal: goal.trim() }) });
      await qc.invalidateQueries();
      toast(t('profile.updated'));
      router.back();
    } catch {
      toast(t('common.tryAgain'));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 4 }}><T s={15}>{t('common.cancel')}</T></Pressable>
        <T s={16} w="700">{t('profile.edit')}</T>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={save} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
          <T s={15} w="700" c={canSave ? c.fg : c.faint}>{t('common.done')}</T>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 20, paddingHorizontal: 16, gap: 18 }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Avatar name={user} url={avatar} size={84} />
          <Pressable accessibilityRole="button" onPress={changePhoto} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 4 }}><T s={15} w="600">{t('profile.changePhoto')}</T></Pressable>
        </View>
        <View>
          <Field label={t('profile.name')} value={name} onChangeText={setName} maxLength={40} />
          {nameBad ? <ErrorText>{t('auth.nameOffensive')}</ErrorText> : null}
        </View>
        <View style={{ gap: 6 }}>
          <Field label={t('username.label')} value={user} onChangeText={(v) => setUser(normalizeUsername(v))} maxLength={40} autoCapitalize="none" autoCorrect={false} />
          <T s={12} c={check.color} style={{ lineHeight: 16 }}>{check.note}</T>
        </View>
        <View>
          <Field label={t('profile.bio')} value={bio} onChangeText={setBio} maxLength={150} placeholder={t('profile.bioPh')} />
          {bioBad ? <ErrorText>{t('profile.bioOffensive')}</ErrorText> : null}
        </View>
        <View>
          <Field label={t('profile.goal')} value={goal} onChangeText={setGoalEdit} maxLength={100} placeholder={t('commit.goalPh')} editable={!goalLocked} />
          {goalLocked ? <T s={12} c={c.muted} style={{ lineHeight: 16, marginTop: 6 }}>{t('profile.goalLocked')}</T> : null}
          {saved?.goal && !goalLocked ? <T s={12} c={c.muted} style={{ lineHeight: 16, marginTop: 6 }}>{t('profile.goalFixing', { count: hoursLeft })}</T> : null}
          {goalError ? <ErrorText>{goalError}</ErrorText> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
