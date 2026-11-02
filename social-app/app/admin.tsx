// The review queue, for adults listed in the admins table. Everything here is checked
// again in the database, so a regular account that opens this route sees nothing.
// Safety cases are counted, never shown: they're handled outside the app.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { MediaThumb } from '../components/Media';
import { BackHeader, Button, Chip, Empty, Screen, Spinner, T } from '../components/ui';
import { adminAppeals, adminCounts, adminDecideAppeal, adminMetrics, adminReports, adminResolveReport, amIAdmin } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useMediaUrl } from '../lib/media';
import { toast } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { AdminAppeal, AdminReport } from '../lib/types';

function Stat({ n, label, alert }: { n: number | undefined; label: string; alert?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: alert && n ? c.danger : c.line, alignItems: 'center' }}>
      <T s={18} w="700" c={alert && n ? c.danger : c.fg}>{n ?? '-'}</T>
      <T s={11} c={c.muted} numberOfLines={1}>{label}</T>
    </View>
  );
}

function MessagePhoto({ path }: { path: string }) {
  const url = useMediaUrl(path, 'message-photos');
  return url ? <Image source={{ uri: url }} style={{ width: '100%', aspectRatio: 1, borderRadius: 10 }} contentFit="cover" /> : null;
}

function ReportCard({ r, onDone }: { r: AdminReport; onDone: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const act = (action: 'dismiss' | 'remove' | 'suspend') => {
    const run = async () => {
      setBusy(true);
      try { await adminResolveReport(r.report_id, action); onDone(); } catch { toast(t('common.tryAgain')); setBusy(false); }
    };
    if (action === 'dismiss') return run();
    Alert.alert(t(`admin.${action}Title`), t(`admin.${action}Body`, { name: r.subject ?? '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t(`admin.${action}`), style: 'destructive', onPress: run },
    ]);
  };
  return (
    <View style={{ padding: 14, gap: 10, borderRadius: 14, borderWidth: c.cardBorderWidth, borderColor: c.cardBorderColor, backgroundColor: c.surface }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <T s={13} w="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {t(`admin.target_${r.kind === 'story' ? 'story' : r.target_type}`)}{r.open_on_target > 1 ? ` · ${t('admin.reportsCount', { count: r.open_on_target })}` : ''}
        </T>
        <T s={12} c={c.muted}>{timeAgo(r.created_at, t)}</T>
      </View>
      <T s={14} style={{ lineHeight: 20 }}>{r.reason}</T>
      <T s={12} c={c.muted}>
        {t('admin.reportedBy', { name: r.reporter })}{r.subject ? ` · ${t('admin.about', { name: r.subject })}` : ''}{r.subject_is_minor ? ` · ${t('admin.minor')}` : ''}
      </T>
      {r.media_path && r.media_type ? <MediaThumb post={{ media_path: r.media_path, media_type: r.media_type }} style={{ height: 260, borderRadius: 10 }} /> : null}
      {r.photo_path ? <MessagePhoto path={r.photo_path} /> : null}
      {r.caption || r.body ? <T s={14} c={c.fg} style={{ padding: 10, borderRadius: 10, backgroundColor: c.surface2, lineHeight: 20 }}>{r.caption || r.body}</T> : null}
      {r.target_type === 'problem' ? null : (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button kind="secondary" label={t('admin.dismiss')} disabled={busy} onPress={() => act('dismiss')} style={{ flex: 1 }} />
          {r.target_type !== 'user' ? <Button kind="secondary" label={t('admin.remove')} disabled={busy} onPress={() => act('remove')} style={{ flex: 1 }} /> : null}
          <Button label={t('admin.suspend')} disabled={busy} onPress={() => act('suspend')} style={{ flex: 1 }} />
        </View>
      )}
      {r.target_type === 'problem' ? <Button kind="secondary" label={t('admin.markRead')} disabled={busy} onPress={() => act('dismiss')} /> : null}
    </View>
  );
}

function AppealCard({ a, onDone }: { a: AdminAppeal; onDone: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const decide = async (overturn: boolean) => {
    setBusy(true);
    try { await adminDecideAppeal(a.appeal_id, overturn); onDone(); } catch { toast(t('common.tryAgain')); setBusy(false); }
  };
  return (
    <View style={{ padding: 14, gap: 10, borderRadius: 14, borderWidth: c.cardBorderWidth, borderColor: c.cardBorderColor, backgroundColor: c.surface }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T s={13} w="700">{a.username} · {t(`subtag.${a.subtag}`)}</T>
        <T s={12} c={c.muted}>{timeAgo(a.created_at, t)}</T>
      </View>
      <MediaThumb post={{ media_path: a.media_path, media_type: a.media_type }} style={{ height: 260, borderRadius: 10 }} />
      {a.caption ? <T s={14} style={{ lineHeight: 20 }}>{a.caption}</T> : null}
      <T s={13} c={c.muted} style={{ lineHeight: 18 }}>
        {t('admin.verdict', { result: a.verdict.violation ? t('admin.brokeRule', { rule: a.verdict.violation }) : t('admin.offTopic') })}
        {a.verdict.reason ? ` ${a.verdict.reason}` : ''}
      </T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button kind="secondary" label={t('admin.uphold')} disabled={busy} onPress={() => decide(false)} style={{ flex: 1 }} />
        <Button label={t('admin.overturn')} disabled={busy} onPress={() => decide(true)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export default function Admin() {
  const c = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'reports' | 'appeals'>('reports');
  const { data: allowed, isLoading: checking } = useQuery({ queryKey: ['am-admin'], queryFn: amIAdmin });
  const counts = useQuery({ queryKey: ['admin-counts'], enabled: !!allowed, queryFn: adminCounts });
  const metrics = useQuery({ queryKey: ['admin-metrics'], enabled: !!allowed, queryFn: adminMetrics });
  const reports = useQuery({ queryKey: ['admin-reports'], enabled: !!allowed && tab === 'reports', queryFn: adminReports });
  const appeals = useQuery({ queryKey: ['admin-appeals'], enabled: !!allowed && tab === 'appeals', queryFn: adminAppeals });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin-') });

  if (checking) return <Screen><BackHeader /><Spinner /></Screen>;
  if (!allowed) return <Screen><BackHeader /><Empty text={t('admin.notAllowed')} /></Screen>;

  const k = counts.data;
  const m = metrics.data;
  const list = tab === 'reports' ? reports : appeals;

  return (
    <Screen>
      <BackHeader title={t('admin.title')} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {k?.open_safety ? (
          <View style={{ padding: 14, borderRadius: 12, borderWidth: 2, borderColor: c.danger, gap: 4 }}>
            <T s={14} w="700" c={c.danger}>{t('admin.safetyTitle', { count: k.open_safety })}</T>
            <T s={13} style={{ lineHeight: 18 }}>{t('admin.safetyBody')}</T>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat n={k?.open_reports} label={t('admin.reports')} />
          <Stat n={k?.open_appeals} label={t('admin.appeals')} />
          <Stat n={k?.stuck_posts} label={t('admin.stuck')} alert />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat n={m?.active_today} label={t('admin.activeToday')} />
          <Stat n={m?.active_7d} label={t('admin.active7d')} />
          <Stat n={m?.signups_7d} label={t('admin.signups7d')} />
          <Stat n={m?.errors_24h} label={t('admin.errors24h')} alert />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label={t('admin.reports')} on={tab === 'reports'} onPress={() => setTab('reports')} />
          <Chip label={t('admin.appeals')} on={tab === 'appeals'} onPress={() => setTab('appeals')} />
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" onPress={refresh} style={{ justifyContent: 'center', paddingHorizontal: 8 }}><T s={14} w="600" c={c.muted}>{t('admin.refresh')}</T></Pressable>
        </View>
        {list.isLoading ? <Spinner /> : null}
        {tab === 'reports' ? (reports.data ?? []).map((r) => <ReportCard key={r.report_id} r={r} onDone={refresh} />) : null}
        {tab === 'appeals' ? (appeals.data ?? []).map((a) => <AppealCard key={a.appeal_id} a={a} onDone={refresh} />) : null}
        {!list.isLoading && (list.data ?? []).length === 0 ? <Empty text={t('admin.empty')} /> : null}
      </ScrollView>
    </Screen>
  );
}
