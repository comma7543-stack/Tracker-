import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ReportTarget } from './types';

export const useAuth = create<{ session: Session | null; ready: boolean; set: (s: Session | null) => void }>((set) => ({
  session: null,
  ready: false,
  set: (session) => set({ session, ready: true }),
}));

export const myId = () => useAuth.getState().session?.user.id ?? '';

export const DEFAULT_PREFS = {
  autoFreeze: true, streakRemind: true, pauseAll: false, nLikes: true, nFollows: true, nDms: true,
  isPrivate: false, showLists: true, hideOffensive: true, dataSaver: false, autoplayWifi: false, reduceMotion: false,
};
export const DEFAULT_CHOICES = {
  reminderTime: '9 PM', timeLimit: 'Off', dmWho: 'People you follow', commentWho: 'Everyone',
  streakWho: 'Everyone', theme: 'white', lang: '',
};
export type Prefs = typeof DEFAULT_PREFS;
export type Choices = typeof DEFAULT_CHOICES;

// Local cache of the settings row, so theme and language apply before the network answers.
export const useSettings = create<{
  prefs: Prefs;
  choices: Choices;
  hydrate: (p: Partial<Prefs>, c: Partial<Choices>) => void;
  setPref: (k: keyof Prefs, v: boolean) => void;
  setChoice: (k: keyof Choices, v: string) => void;
}>()(
  persist(
    (set) => ({
      prefs: DEFAULT_PREFS,
      choices: DEFAULT_CHOICES,
      hydrate: (p, c) => set((s) => ({ prefs: { ...s.prefs, ...p }, choices: { ...s.choices, ...c } })),
      setPref: (k, v) => set((s) => ({ prefs: { ...s.prefs, [k]: v } })),
      setChoice: (k, v) => set((s) => ({ choices: { ...s.choices, [k]: v } })),
    }),
    { name: 'settings-cache', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

// The questions asked before log in and sign up, kept on this device because no account
// exists yet. Sign-up copies the goal to the profile. The number stays here. Signing out clears both.
export const useCommitment = create<{
  goal: string;
  dedication: number | null;
  done: boolean;
  hydrated: boolean;
  finish: (goal: string, dedication: number) => void;
  reset: () => void;
}>()(
  persist(
    (set) => ({
      goal: '',
      dedication: null,
      done: false,
      hydrated: false,
      finish: (goal, dedication) => set({ goal, dedication, done: true }),
      reset: () => set({ goal: '', dedication: null, done: false }),
    }),
    {
      name: 'commitment',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ goal, dedication, done }) => ({ goal, dedication, done }),
      onRehydrateStorage: () => () => { useCommitment.setState({ hydrated: true }); },
    },
  ),
);

// Fields collected across the onboarding screens, sent together at Terms.
export const useSignup = create<{
  contact: string; mode: 'phone' | 'email'; fullName: string; dob: string; username: string;
  /** In a password reset, so the auth router must leave the screens alone. */
  resetting: boolean;
  patch: (p: Partial<{ contact: string; mode: 'phone' | 'email'; fullName: string; dob: string; username: string; resetting: boolean }>) => void;
}>((set) => ({ contact: '', mode: 'phone', fullName: '', dob: '', username: '', resetting: false, patch: (p) => set(p) }));

type Sheet =
  | { type: 'comments'; postId: string }
  | { type: 'share'; postId: string; ownerId: string }
  | { type: 'create' }
  | { type: 'suspended' }
  | { type: 'streak' }
  | { type: 'report'; target: ReportTarget };

export const useUI = create<{
  toast: string;
  sheet: Sheet | null;
  showToast: (m: string) => void;
  open: (s: Sheet) => void;
  close: () => void;
}>((set) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    toast: '',
    sheet: null,
    showToast: (toast) => {
      clearTimeout(timer);
      set({ toast });
      timer = setTimeout(() => set({ toast: '' }), 1800);
    },
    open: (sheet) => set({ sheet }),
    close: () => set({ sheet: null }),
  };
});

export const toast = (m: string) => useUI.getState().showToast(m);
