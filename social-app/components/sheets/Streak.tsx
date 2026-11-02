import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Snowflake } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { postedDates, profileGoal, reasonDaysLeft, spendReasonDay } from '../../lib/api';
import { errorText } from '../../lib/format';
import { useMyStreak, useNow, useStartCompose } from '../../lib/hooks';
import { myId, toast, useCommitment, useSettings } from '../../lib/store';
import { badgeProgress, BADGE_GOALS, effectiveStreak, freezesLeft, isFrozen, localDate, reasonDayOptions, timeLeftToday, weekDates } from '../../lib/streak';
import { DARK, FIRE, flamePalette, textGlow, useTheme } from '../../lib/theme';
import { StreakFlame } from '../StreakFlame';
import { Button, Chip, GoalCard, SheetFrame, T } from '../ui';

const BADGE_LABELS: Record<number, string> = { 3: 'streak.badge3', 7: 'streak.badge7', 30: 'streak.badge30', 100: 'streak.badge100' };
const REASONS = ['sick', 'family', 'travel', 'noPhone', 'other'];

/** Pick a reason to protect today, or yesterday if it was missed. */
function ReasonDay({ options, today }: { options: string[]; today: string }) {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(options[0]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: left } = useQuery({ queryKey: ['reason-days-left'], queryFn: reasonDaysLeft });
  const chosen = options.includes(day) ? day : options[0];

  const submit = async () => {
    setBusy(true);
    try {
      await spendReasonDay(chosen, reason);
      toast(t('streak.reasonDone'));
      setOpen(false);
      setReason('');
      qc.invalidateQueries();
    } catch (e) {
      toast(errorText(e).includes('reason_limit') ? t('streak.reasonNone') : t('common.tryAgain'));
    }
    setBusy(false);
  };

  if (!open) return <Button kind="secondary" label={t('streak.reasonOpen')} onPress={() => setOpen(true)} />;

  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.line }}>
      <T s={16} w="700">{t('streak.reasonTitle')}</T>
      {left === 0 ? <T s={14} c={c.muted}>{t('streak.reasonNone')}</T> : (
        <>
          {options.length > 1 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {options.map((d) => <Chip key={d} label={d === today ? t('streak.reasonToday') : t('streak.reasonYesterday')} on={d === chosen} onPress={() => setDay(d)} />)}
            </View>
          ) : <T s={14} c={c.muted}>{chosen === today ? t('streak.reasonToday') : t('streak.reasonYesterday')}</T>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REASONS.map((r) => <Chip key={r} label={t(`streak.reason.${r}`)} on={reason === r} onPress={() => setReason(r)} />)}
          </View>
          {left !== undefined ? <T s={13} c={c.muted}>{t('streak.reasonsLeft', { n: left })}</T> : null}
          <Button label={t('streak.reasonConfirm')} disabled={!reason} busy={busy} onPress={submit} />
        </>
      )}
    </View>
  );
}

export function StreakSheet({ onClose }: { onClose: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const streak = useMyStreak();
  const autoFreeze = useSettings((s) => s.prefs.autoFreeze);
  const { data: goal } = useQuery({ queryKey: ['goal', myId()], queryFn: () => profileGoal(myId()) });
  const dedication = useCommitment((s) => s.dedication);
  const { compose } = useStartCompose();
  const now = useNow();
  const today = localDate(now);
  const week = weekDates(now);
  const { data: dates = [] } = useQuery({
    queryKey: ['posted-dates', week[0].date],
    queryFn: () => postedDates(new Date(`${week[0].date}T00:00:00`).toISOString()),
  });
  const posted = new Set(dates.map((iso) => localDate(new Date(iso))));
  const count = streak ? effectiveStreak(streak, today, autoFreeze) : 0;
  const frozen = !!streak && isFrozen(streak, today, autoFreeze);
  // Colors stay plain until there's a streak to color.
  const flame = count > 0 ? flamePalette(count, frozen).outer : c.fg;
  const left = streak ? freezesLeft(streak, today, autoFreeze) : 0;
  const doneToday = streak?.last_post_date === today;
  const { hours, minutes } = timeLeftToday(now);
  const progress = badgeProgress(count);
  const letters = t('streak.weekLetters').split(',');

  const excused = streak?.excused_dates ?? [];
  const options = streak ? reasonDayOptions(streak, today, autoFreeze) : [];

  const message = doneToday
    ? t('streak.done', { next: count + 1 })
    : excused.includes(today) ? t('streak.frozenToday')
    : frozen ? t('streak.frozenHold')
    : count > 0 ? t('streak.keepAlive', { hours, minutes }) : t('streak.start');

  return (
    <SheetFrame title={t('streak.title')} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        {goal ? <GoalCard goal={goal} dedication={dedication} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <StreakFlame count={count} frozen={frozen} size={64} />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <T s={40} w="800" c={flame} style={[{ lineHeight: 44 }, count > 0 ? textGlow(c) : null]}>{count}</T>
              <T s={15} w="600">{t('streak.dayStreak')}</T>
            </View>
            <T s={13} c={c.muted} style={{ lineHeight: 18 }}>{message}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T s={11} w="600" c={c.muted} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>{t('streak.best')}</T>
            <T s={18} w="700">{streak?.best ?? 0}</T>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {week.map((d, i) => {
            const isPosted = posted.has(d.date);
            const isFrozen = !isPosted && excused.includes(d.date);
            const isToday = d.date === today;
            const past = d.date < today;
            return (
              <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <T s={11} w="600" c={isToday ? c.fg : c.muted}>{letters[i]}</T>
                <View
                  accessibilityLabel={`${d.date}, ${isPosted ? t('streak.dayPosted') : isFrozen ? t('streak.dayFrozen') : isToday ? t('streak.dayToday') : past ? t('streak.dayMissed') : t('streak.dayUpcoming')}`}
                  style={[
                    { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
                    isPosted ? { backgroundColor: flamePalette(Math.max(count, 1)).outer } : isFrozen ? { backgroundColor: FIRE.frozen.outer } : isToday ? { borderWidth: 2, borderColor: c.fg } : past ? { borderWidth: 1.5, borderColor: c.faint, borderStyle: 'dashed' } : { borderWidth: 1, borderColor: c.line },
                  ]}
                >
                  {isPosted ? <Check size={16} color={DARK.fg} strokeWidth={3} /> : isFrozen ? <Snowflake size={16} color={DARK.fg} strokeWidth={2} /> : <T s={13} w="700" c={isToday ? c.fg : c.muted}>{d.day}</T>}
                </View>
              </View>
            );
          })}
        </View>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <T s={13} w="600">{t('streak.nextBadge', { label: BADGE_LABELS[progress.next] ? t(BADGE_LABELS[progress.next]) : t('streak.days', { count: progress.next }) })}</T>
            <T s={12} c={c.muted}>{count} / {progress.next} · {t('streak.toGo', { count: progress.toGo })}</T>
          </View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.next, now: count }} style={{ height: 8, borderRadius: 999, backgroundColor: c.surface2, overflow: 'hidden' }}>
            <View style={{ height: '100%', minWidth: 8, width: `${Math.round(progress.fraction * 100)}%`, borderRadius: 999, backgroundColor: flame }} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
          {BADGE_GOALS.map((g) => {
            const earned = count >= g;
            const isNext = g === progress.next;
            return (
              <View key={g} style={{ flex: 1, alignItems: 'center', gap: 10 }}>
                <View
                  accessibilityLabel={`${t(BADGE_LABELS[g])}, ${earned ? t('streak.earned') : t('streak.locked')}`}
                  style={[
                    { width: 44, height: 44, borderRadius: 12, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
                    earned ? { backgroundColor: flamePalette(g).outer } : isNext ? { borderWidth: 1.5, borderColor: c.fg } : { borderWidth: 1, borderColor: c.line, opacity: 0.5 },
                  ]}
                >
                  <T s={15} w="800" c={earned ? DARK.fg : isNext ? c.fg : c.muted} style={{ transform: [{ rotate: '-45deg' }] }}>{g}</T>
                </View>
                <T s={11} w="600" c={earned || isNext ? c.fg : c.muted}>{t(BADGE_LABELS[g])}</T>
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Snowflake size={18} color={FIRE.frozen.outer} strokeWidth={2.2} />
          <T s={14} w="600" c={FIRE.frozen.outer}>{t('streak.freezes', { count: left })}</T>
        </View>
        {!doneToday ? <Button label={t('streak.postToday')} onPress={() => compose('post')} /> : null}
        {options.length > 0 ? <ReasonDay options={options} today={today} /> : null}
      </ScrollView>
    </SheetFrame>
  );
}
