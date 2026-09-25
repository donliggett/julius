import type { CompiledEntry, LogRow, Ports } from "./types.js";

/**
 * In-memory ports for tests, local development, and the conformance harness.
 * Rate limits use fixed one-minute windows. Not for production: nothing persists.
 */
export function createMemoryPorts(init: { now?: () => number } = {}) {
  const entries = new Map<string, CompiledEntry>();
  const keys = new Map<string, Map<string, string>>();
  const windows = new Map<string, number>();
  const spend = new Map<string, number>();
  const killed = new Set<string>();
  const logs: LogRow[] = [];
  let seq = 0;
  const ports: Ports = {
    entries: { get: (slug) => entries.get(slug) },
    keys: { verify: (entry, token) => keys.get(entry)?.get(token) ?? null },
    rateLimit: {
      hit: (scope, nowMs) => {
        const k = `${scope}|${Math.floor(nowMs / 60_000)}`;
        const n = (windows.get(k) ?? 0) + 1;
        windows.set(k, n);
        return n;
      },
    },
    spend: {
      get: (entry, day) => spend.get(`${entry}|${day}`) ?? 0,
      add: (entry, day, usd) => { spend.set(`${entry}|${day}`, (spend.get(`${entry}|${day}`) ?? 0) + usd); },
    },
    kill: { isKilled: (entry) => killed.has(entry) || killed.has("*") },
    log: { write: (row) => { logs.push(row); } },
    clock: init.now ? { now: init.now } : undefined,
    ids: { next: () => `id-${++seq}` },
  };
  return {
    ports,
    logs,
    addEntry(entry: CompiledEntry) { entries.set(entry.slug, entry); },
    addKey(entry: string, token: string, keyId = `${entry}:${token.slice(0, 4)}`) {
      if (!keys.has(entry)) keys.set(entry, new Map());
      keys.get(entry)!.set(token, keyId);
    },
    addSpend(entry: string, day: string, usd: number) { ports.spend.add(entry, day, usd); },
    kill(scope: string) { killed.add(scope); },
    unkill(scope: string) { killed.delete(scope); },
  };
}
