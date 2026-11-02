import * as Notifications from 'expo-notifications';
import i18n from './i18n';
import { useSettings } from './store';
import { effectiveStreak, localDate } from './streak';

const DAYS_AHEAD = 14;
const HOURS: Record<string, number> = { '6 PM': 18, '9 PM': 21, '11 PM': 23 };

// Local one-shot notifications: a repeating trigger can't skip a day already
// posted. Called on launch, after posting and when settings change.
export async function scheduleStreakReminders(streak?: { current: number; last_post_date: string | null; freezes_available?: number; excused_dates?: string[] } | null) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const { prefs, choices } = useSettings.getState();
  if (!prefs.streakRemind || prefs.pauseAll) return;
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return;

  const hour = HOURS[choices.reminderTime] ?? 21;
  const now = new Date();
  const postedToday = streak?.last_post_date === localDate(now) || !!streak?.excused_dates?.includes(localDate(now));
  const count = streak ? effectiveStreak(streak, localDate(now), prefs.autoFreeze) : 0;

  for (let i = 0; i < DAYS_AHEAD; i += 1) {
    if (i === 0 && postedToday) continue;
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hour);
    if (at <= now) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('reminder.title'),
        body: count > 0 ? i18n.t('reminder.keep', { count }) : i18n.t('reminder.start'),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  }
}
