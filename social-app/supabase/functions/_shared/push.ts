// Turns outbox rows into Expo push messages and reads Expo's answers. Free of Deno
// and network code so tests/push.test.ts can run it.

export type OutboxRow = { outbox_id: number; token: string; body: string; data: Record<string, unknown>; badge: number };

export type ExpoMessage = {
  to: string; body: string; data: Record<string, unknown>; sound: 'default'; badge: number; channelId: string; priority: 'high';
};

// Expo's per-request maximum.
export const EXPO_BATCH = 100;

export const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t);

export function buildMessages(rows: OutboxRow[]): ExpoMessage[] {
  return rows.filter((r) => isExpoToken(r.token)).map((r) => ({
    to: r.token, body: r.body, data: r.data ?? {}, sound: 'default', badge: Math.max(0, r.badge ?? 0), channelId: 'default', priority: 'high',
  }));
}

export function chunk<T>(items: T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Ticket = { status: 'ok' | 'error'; details?: { error?: string } };

/**
 * Which tokens to forget, from one request's tickets (same order as its messages).
 * Other errors are left alone: the row still counts as sent, so one bad message
 * can't make a whole batch repeat.
 */
export function deadTokens(messages: ExpoMessage[], tickets: Ticket[]): string[] {
  return messages.filter((_, i) => tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered').map((m) => m.to);
}

export type PushDeps = {
  claim: () => Promise<OutboxRow[]>;
  send: (messages: ExpoMessage[]) => Promise<Ticket[]>;
  finish: (sent: number[], dead: string[]) => Promise<void>;
};

/**
 * One drain of the outbox. A request that fails (network, Expo down) leaves its rows
 * unsent; their claim lapses and the next run tries again.
 */
export async function drain(deps: PushDeps): Promise<{ sent: number; failed: number }> {
  const rows = await deps.claim();
  const sent: number[] = [];
  const dead: string[] = [];
  let failed = 0;
  // Rows without a usable token are done: there's nothing to send them to.
  for (const r of rows) if (!isExpoToken(r.token)) { sent.push(r.outbox_id); dead.push(r.token); }

  const valid = rows.filter((r) => isExpoToken(r.token));
  const pairs = chunk(valid);
  for (const part of pairs) {
    const messages = buildMessages(part);
    try {
      const tickets = await deps.send(messages);
      dead.push(...deadTokens(messages, tickets));
      sent.push(...part.map((r) => r.outbox_id));
    } catch {
      failed += part.length;
    }
  }
  await deps.finish([...new Set(sent)], [...new Set(dead)]);
  return { sent: valid.length - failed, failed };
}
