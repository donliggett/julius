import { pickBand } from "./bands.js";
import { BadParams, expandQuestions } from "./expand.js";
import { BadAnswer, normalizeAnswers } from "./normalize.js";
import type {
  BatchEnvelope, BatchItemEnvelope, CompiledEntry, CompiledSet, DeciderOptions, Envelope, HttpRequest,
  LogRow, Ports, ProviderAdapter, Status,
} from "./types.js";
import { JULIUS_VERSION, ProviderError } from "./types.js";

const ITEM_ID = /^[a-z0-9_-]+$/;
const PROVIDER_REASON = { timeout: "provider_timeout", down: "provider_down", error: "provider_error", rate_limited: "provider_rate_limited" } as const;

export interface Decider {
  /** Route a request to /v1/decide or /v1/decide/batch and return an HTTP status plus the envelope. */
  handle(req: HttpRequest): Promise<{ status: number; body: Envelope | BatchEnvelope }>;
  decide(req: HttpRequest): Promise<Envelope>;
  decideBatch(req: HttpRequest): Promise<BatchEnvelope>;
}

/** Suggested HTTP codes (Standard section 7). The envelope is the source of truth. */
export function httpStatus(env: { status: Status; reason?: string }): number {
  switch (env.status) {
    case "ok": return 200;
    case "rate_limited": case "over_budget": return 429;
    case "unavailable": return 503;
    default: return env.reason === "auth_failed" ? 401 : env.reason === "origin_not_allowed" ? 403 : 400;
  }
}

const header = (h: Record<string, string | undefined>, name: string) => {
  const k = Object.keys(h).find((x) => x.toLowerCase() === name);
  return k ? h[k] : undefined;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function createDecider(config: { ports: Ports; providers: ProviderAdapter[]; options?: DeciderOptions }): Decider {
  const { ports, providers } = config;
  const opt = config.options ?? {};
  const now = () => ports.clock?.now() ?? Date.now();
  const newId = () => ports.ids?.next() ?? globalThis.crypto.randomUUID();
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  type Ctx = { t0: number; rid: string; body: unknown };
  const base = (c: Ctx, status: Status, reason: string, extra: Record<string, unknown> = {}) => {
    const env: Record<string, unknown> = { status, julius: JULIUS_VERSION };
    if (isObj(c.body)) {
      if (typeof c.body.entry === "string") env.entry = c.body.entry;
      if (typeof c.body.set === "string") env.set = c.body.set;
    }
    env.reason = reason;
    Object.assign(env, extra);
    env.ms = now() - c.t0;
    env.request_id = c.rid;
    return env;
  };

  /** Steps 1-5 of the check order. Returns the resolved entry and set, or a failure envelope. */
  async function front(req: HttpRequest, batch: boolean): Promise<
    { fail: Record<string, unknown>; ctx: Ctx } | { ctx: Ctx; entry: CompiledEntry; set: CompiledSet }
  > {
    const t0 = now();
    let body: unknown = req.body;
    if (req.rawBody !== undefined) {
      try { body = JSON.parse(req.rawBody); } catch { body = undefined; }
    }
    const rid = isObj(body) && typeof body.request_id === "string" && body.request_id ? body.request_id : newId();
    const ctx: Ctx = { t0, rid, body };
    const b = body as Record<string, unknown>;
    if (!isObj(body) || typeof b.entry !== "string" || typeof b.set !== "string" || (batch ? !("items" in b) : !("state" in b))) {
      return { ctx, fail: base(ctx, "rejected", "bad_request") };
    }
    const entry = await ports.entries.get(b.entry as string);
    if (!entry) return { ctx, fail: base(ctx, "rejected", "unknown_entry") };
    let rateScope: string | undefined, limit: number | undefined;
    if (entry.access === "private") {
      const auth = header(req.headers, "authorization") ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      const keyId = m ? await ports.keys.verify(entry.slug, m[1].trim()) : null;
      if (!keyId) return { ctx, fail: base(ctx, "rejected", "auth_failed") };
      if (opt.privatePerKeyPerMin !== undefined) { rateScope = `key:${entry.slug}:${keyId}`; limit = opt.privatePerKeyPerMin; }
    } else {
      const origin = header(req.headers, "origin");
      if (!origin || !entry.origins.includes(origin)) return { ctx, fail: base(ctx, "rejected", "origin_not_allowed") };
      rateScope = `ip:${entry.slug}:${req.clientIp}`;
      limit = entry.perIpPerMin;
    }
    if (rateScope && limit !== undefined) {
      const t = now();
      const count = await ports.rateLimit.hit(rateScope, t);
      if (count > limit) return { ctx, fail: base(ctx, "rate_limited", "caller_rate_limit", { retry_after: Math.max(1, 60 - Math.floor((t / 1000) % 60)) }) };
    }
    const set = entry.sets[b.set as string];
    if (!set) return { ctx, fail: base(ctx, "rejected", "unknown_set") };
    return { ctx, entry, set };
  }

  async function writeLog(entry: CompiledEntry, set: CompiledSet, ctx: Ctx, itemId: string | undefined, env: Record<string, unknown>, state: unknown, extra: { cost?: number; tokens?: number } = {}) {
    const row: LogRow = {
      id: newId(), ts: now(), request_id: ctx.rid, entry: entry.slug, set: set.name, set_hash: set.setHash,
      status: env.status as Status, ms: env.ms as number,
    };
    if (itemId !== undefined) row.item_id = itemId;
    if (env.reason) row.reason = env.reason as string;
    if (env.provider) { row.provider = env.provider as string; row.model = env.model as string; row.calibrated = env.calibrated as boolean; }
    if ("band" in env) row.band = env.band as string | null;
    if (extra.cost !== undefined) row.cost_usd = extra.cost;
    if (extra.tokens !== undefined) row.input_tokens = extra.tokens;
    if (entry.log !== "none" && env.answers) row.answers = env.answers as LogRow["answers"];
    if (entry.log === "full") row.state = state;
    await ports.log.write(row);
  }

  /** Steps 6-13 for one state (a single request or one batch item). */
  async function runOne(entry: CompiledEntry, set: CompiledSet, ctx: Ctx, state: unknown, params: unknown, itemId?: string): Promise<Record<string, unknown>> {
    const per = opt.entryOptions?.(entry.slug) ?? {};
    const failWith = async (status: Status, reason: string, extra: Record<string, unknown> = {}) => {
      const env = base(ctx, status, reason, extra);
      env.entry = entry.slug; env.set = set.name;
      await writeLog(entry, set, ctx, itemId, env, state);
      return env;
    };
    const supporting = providers.filter((p) => p.supports(entry.model));
    // 6. params and state size
    let questions;
    try { questions = expandQuestions(set, params); }
    catch (x) { if (x instanceof BadParams) return failWith("rejected", "bad_params"); throw x; }
    const limits = [opt.maxStateChars, per.maxStateChars, ...supporting.map((p) => p.limits.maxStateChars)].filter((n): n is number => typeof n === "number");
    const size = JSON.stringify(state ?? null).length;
    if (limits.length && size > Math.min(...limits)) return failWith("rejected", "state_too_large");
    // 7. kill switch, then budget
    const t = now(), day = dayOf(t);
    if (await ports.kill.isKilled(entry.slug, t)) return failWith("over_budget", "killed");
    if (opt.globalDailyUsd !== undefined && (await ports.spend.get("*", day)) >= opt.globalDailyUsd) return failWith("over_budget", "global_budget");
    if ((await ports.spend.get(entry.slug, day)) >= entry.dailyUsd) return failWith("over_budget", "entry_budget");
    // 8. acceptable providers
    if (supporting.length === 0) return failWith("unavailable", "x_no_provider_for_model");
    const candidates = entry.acceptUncalibrated ? supporting : supporting.filter((p) => p.calibrated);
    if (candidates.length === 0) return failWith("unavailable", "no_calibrated_provider");
    // 9. call providers in order
    const timeoutMs = per.timeoutMs ?? opt.timeoutMs ?? 10_000;
    let lastReason = "provider_error";
    for (const p of candidates) {
      const ac = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const res = await Promise.race([
          p.decide({ model: entry.model, state, questions, timeoutMs, signal: ac.signal }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new ProviderError("timeout")); }, timeoutMs); }),
        ]);
        // 10-11. normalize and band
        const answers = normalizeAnswers(questions, res.answers);
        const cost = Number.isFinite(res.costUsd) ? res.costUsd : 0;
        await ports.spend.add(entry.slug, day, cost);
        if (opt.globalDailyUsd !== undefined) await ports.spend.add("*", day, cost);
        const env: Record<string, unknown> = {
          status: "ok", julius: JULIUS_VERSION, entry: entry.slug, set: set.name, set_hash: set.setHash,
          provider: p.name, model: entry.model, calibrated: p.calibrated, answers,
        };
        if (set.bands) env.band = pickBand(set.bands, answers);
        env.ms = now() - ctx.t0;
        env.request_id = ctx.rid;
        // 12. record
        await writeLog(entry, set, ctx, itemId, env, state, { cost, tokens: res.inputTokens });
        return env;
      } catch (x) {
        if (x instanceof ProviderError) lastReason = PROVIDER_REASON[x.kind] ?? "provider_error";
        else if (x instanceof BadAnswer) lastReason = "provider_error";
        else lastReason = "provider_error";
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return failWith("unavailable", lastReason);
  }

  async function decide(req: HttpRequest): Promise<Envelope> {
    const r = await front(req, false);
    if ("fail" in r) return r.fail as unknown as Envelope;
    const b = r.ctx.body as Record<string, unknown>;
    return (await runOne(r.entry, r.set, r.ctx, b.state, b.params)) as unknown as Envelope;
  }

  async function decideBatch(req: HttpRequest): Promise<BatchEnvelope> {
    const r = await front(req, true);
    if ("fail" in r) return r.fail as unknown as BatchEnvelope;
    const b = r.ctx.body as Record<string, unknown>;
    const items = b.items;
    const bad = () => base(r.ctx, "rejected", "bad_request") as unknown as BatchEnvelope;
    if (!Array.isArray(items)) return bad();
    const ids = new Set<string>();
    for (const it of items) {
      if (!isObj(it) || typeof it.id !== "string" || !ITEM_ID.test(it.id) || !("state" in it) || ids.has(it.id)) return bad();
      ids.add(it.id);
    }
    if (items.length > (opt.maxBatchItems ?? 100)) return base(r.ctx, "rejected", "batch_too_large") as unknown as BatchEnvelope;
    const results: BatchItemEnvelope[] = new Array(items.length);
    const width = Math.max(1, opt.batchConcurrency ?? 1);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        const it = items[i] as Record<string, unknown>;
        const env = await runOne(r.entry, r.set, r.ctx, it.state, it.params, it.id as string);
        results[i] = { id: it.id as string, ...env } as BatchItemEnvelope;
      }
    };
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
    return {
      status: "ok", julius: JULIUS_VERSION, entry: r.entry.slug, set: r.set.name, results,
      ms: now() - r.ctx.t0, request_id: r.ctx.rid,
    };
  }

  async function handle(req: HttpRequest) {
    const path = req.path.replace(/\/+$/, "");
    const body = path === "/v1/decide/batch" ? await decideBatch(req)
      : path === "/v1/decide" ? await decide(req)
      : ({ status: "rejected", julius: JULIUS_VERSION, reason: "bad_request", ms: 0, request_id: newId() } as Envelope);
    return { status: httpStatus(body), body };
  }

  return { handle, decide, decideBatch };
}
