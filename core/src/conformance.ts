/**
 * Runner for the Julius conformance suite (conformance/ in the Julius repo).
 * Language-neutral cases live in JSON; this runs them against any decider built on
 * this core, or any other decider a harness can wrap.
 */
import type { HttpRequest, LogRow, ProviderAdapter, RawAnswer } from "./types.js";
import { ProviderError } from "./types.js";

type Scripted = { answers: Record<string, RawAnswer>; cost_usd?: number } | { error: "timeout" | "down" | "error" | "rate_limited" };

/** The suite's mock provider (see conformance/README.md, "Mock provider contract"). */
export function createMockProvider(overrides: { calibrated?: boolean; max_questions?: number; max_state_chars?: number } = {}) {
  const lim = { calibrated: true, max_questions: 20, max_state_chars: 2000, ...overrides };
  const calls: Array<{ model: string; state: unknown; questions: unknown[] }> = [];
  let queue: Scripted[] = [];
  let unexpected = 0;
  const adapter: ProviderAdapter = {
    name: "mock",
    calibrated: lim.calibrated,
    limits: { maxQuestions: lim.max_questions, maxStateChars: lim.max_state_chars },
    supports: () => true,
    async decide({ model, state, questions }) {
      calls.push({ model, state, questions: questions.map((q) => ({ ...q })) });
      const r = queue.shift();
      if (!r) { unexpected++; throw new ProviderError("error", "unexpected provider call"); }
      if ("error" in r) throw new ProviderError(r.error);
      return { answers: r.answers, costUsd: r.cost_usd ?? 0 };
    },
  };
  return {
    adapter,
    calls,
    script(responses: Scripted[]) { queue = [...responses]; },
    remaining: () => queue.length,
    takeUnexpected() { const n = unexpected; unexpected = 0; return n; },
  };
}

const TYPES: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => !!v && typeof v === "object" && !Array.isArray(v),
  array: Array.isArray,
  null: (v) => v === null,
};

/** Subset match with $absent / $type / $any (see conformance/README.md, "Matching rules"). */
export function matchExpected(expected: unknown, actual: unknown, path: string, errors: string[]): void {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const e = expected as Record<string, unknown>;
    if ("$type" in e) { if (!TYPES[e.$type as string]?.(actual)) errors.push(`${path}: expected ${e.$type}, got ${JSON.stringify(actual)}`); return; }
    if ("$any" in e) return;
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) { errors.push(`${path}: expected object, got ${JSON.stringify(actual)}`); return; }
    const a = actual as Record<string, unknown>;
    for (const [k, v] of Object.entries(e)) {
      if (v && typeof v === "object" && (v as Record<string, unknown>).$absent) { if (k in a && a[k] !== undefined) errors.push(`${path}.${k}: should be absent, got ${JSON.stringify(a[k])}`); }
      else if (!(k in a) || a[k] === undefined) errors.push(`${path}.${k}: missing`);
      else matchExpected(v, a[k], `${path}.${k}`, errors);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) { errors.push(`${path}: expected a list of ${expected.length}, got ${Array.isArray(actual) ? actual.length : JSON.stringify(actual)}`); return; }
    expected.forEach((e, i) => matchExpected(e, actual[i], `${path}[${i}]`, errors));
    return;
  }
  if (typeof expected === "number" && typeof actual === "number") { if (Math.abs(expected - actual) > 1e-9) errors.push(`${path}: expected ${expected}, got ${actual}`); return; }
  if (expected !== actual) errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export interface ConformanceInstance {
  handle(req: HttpRequest): Promise<{ body: unknown }>;
  /** Register a parsed entry. Private entries must accept the key `k-<slug>`. */
  register(raw: unknown): Promise<{ ok: boolean; reason?: string }>;
  logs(): LogRow[] | Promise<LogRow[]>;
}

export interface ConformanceHarness {
  /** A fresh decider for one case, using `provider` as its only provider and a clock fixed within one minute. */
  create(input: { provider: ProviderAdapter; setup: { killed?: string[]; spent_usd?: Record<string, number> } }): Promise<ConformanceInstance>;
  /** Valid entry files to preload, e.g. ["conf-private.md", ...]. */
  entryFiles(): Promise<string[]>;
  /** The parsed `yaml julius` block of conformance/entries/<file>. */
  loadEntry(file: string): Promise<unknown>;
}

export interface ConformanceCase {
  id: string;
  section: string;
  description: string;
  preload?: boolean;
  setup?: { killed?: string[]; spent_usd?: Record<string, number> };
  provider?: { calibrated?: boolean; max_questions?: number; max_state_chars?: number };
  steps: Array<Record<string, any>>;
}

/** Run one case. Returns a list of problems; empty means it passed. */
export async function runConformanceCase(c: ConformanceCase, harness: ConformanceHarness): Promise<string[]> {
  const errors: string[] = [];
  const mock = createMockProvider(c.provider);
  const inst = await harness.create({ provider: mock.adapter, setup: c.setup ?? {} });
  if (c.preload !== false) {
    for (const f of await harness.entryFiles()) {
      const r = await inst.register(await harness.loadEntry(f));
      if (!r.ok) errors.push(`preload ${f}: registration failed (${r.reason})`);
    }
  }
  for (const [n, s] of c.steps.entries()) {
    const w = `step ${n}`;
    if ("register" in s) {
      matchExpected(s.expect, await inst.register(await harness.loadEntry(s.register)), w, errors);
      continue;
    }
    mock.script(s.responses ?? []);
    const callsBefore = mock.calls.length;
    const logsBefore = (await inst.logs()).length;
    const rq = s.request;
    const req: HttpRequest = { path: rq.path, headers: rq.headers ?? {}, clientIp: rq.client_ip, body: rq.body };
    if ("raw_body" in rq) req.rawBody = rq.raw_body;
    const { body } = await inst.handle(req);
    const ex = s.expect;
    matchExpected(ex.body, body, `${w} body`, errors);
    const text = JSON.stringify(body);
    for (const bad of ex.body_excludes ?? []) if (text.includes(bad)) errors.push(`${w}: response contains ${JSON.stringify(bad)}`);
    const calls = mock.calls.slice(callsBefore);
    if (typeof ex.provider_calls === "number" && calls.length !== ex.provider_calls) errors.push(`${w}: ${calls.length} provider calls, expected ${ex.provider_calls}`);
    if (Array.isArray(ex.provider_calls)) matchExpected(ex.provider_calls, calls, `${w} provider_calls`, errors);
    if ("log" in ex) matchExpected(ex.log, (await inst.logs()).slice(logsBefore), `${w} log`, errors);
    const extra = mock.takeUnexpected();
    if (extra) errors.push(`${w}: ${extra} unexpected provider call(s)`);
    if (mock.remaining()) errors.push(`${w}: ${mock.remaining()} scripted response(s) unused`);
  }
  return errors;
}
