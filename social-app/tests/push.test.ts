import { describe, expect, it, vi } from 'vitest';
import { buildMessages, chunk, deadTokens, drain, OutboxRow } from '../supabase/functions/_shared/push';

const row = (id: number, token = `ExponentPushToken[t${id}xxxxxxxx]`): OutboxRow => ({ outbox_id: id, token, body: `hi ${id}`, data: { type: 'like' }, badge: 2 });

describe('push messages', () => {
  it('builds Expo messages and skips tokens that are not Expo tokens', () => {
    const out = buildMessages([row(1), row(2, 'garbage')]);
    expect(out).toEqual([{ to: 'ExponentPushToken[t1xxxxxxxx]', body: 'hi 1', data: { type: 'like' }, sound: 'default', badge: 2, channelId: 'default', priority: 'high' }]);
  });

  it('splits into Expo-sized requests', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('forgets only tokens Expo says are gone', () => {
    const m = buildMessages([row(1), row(2), row(3)]);
    expect(deadTokens(m, [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ])).toEqual(['ExponentPushToken[t2xxxxxxxx]']);
  });
});

describe('drain', () => {
  it('marks sent rows, drops dead and invalid tokens', async () => {
    const finish = vi.fn(async () => {});
    const res = await drain({
      claim: async () => [row(1), row(2), row(3, 'bad')],
      send: async () => [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
      finish,
    });
    expect(res).toEqual({ sent: 2, failed: 0 });
    expect(finish).toHaveBeenCalledWith([3, 1, 2], ['bad', 'ExponentPushToken[t2xxxxxxxx]']);
  });

  it('leaves a failed request unsent, so it is retried', async () => {
    const finish = vi.fn(async () => {});
    const many = Array.from({ length: 150 }, (_, i) => row(i + 1));
    let call = 0;
    const res = await drain({
      claim: async () => many,
      send: async (m) => { call += 1; if (call === 2) throw new Error('down'); return m.map(() => ({ status: 'ok' as const })); },
      finish,
    });
    expect(res).toEqual({ sent: 100, failed: 50 });
    const [sent] = finish.mock.calls[0] as unknown as [number[], string[]];
    expect(sent).toHaveLength(100);
    expect(sent).not.toContain(101);
  });
});
