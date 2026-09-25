/** Julius Standard version implemented by this core. */
export const JULIUS_VERSION = "0.1";

export type QuestionType = "choice" | "score" | "yesno";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  options: string[] | Record<string, string>;
  each?: string;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  levels: string[];
  each?: string;
}
export interface YesNoQuestion {
  type: "yesno";
  instructions: string;
  if_true?: string;
  if_false?: string;
  each?: string;
}
export type Question = ChoiceQuestion | ScoreQuestion | YesNoQuestion;

/** A question as sent to a provider: `each` expanded, `$shared` resolved. */
export type ExpandedQuestion =
  | (Omit<ChoiceQuestion, "each"> & { id: string })
  | (Omit<ScoreQuestion, "each"> & { id: string })
  | (Omit<YesNoQuestion, "each"> & { id: string });

export interface BandRule {
  band: string;
  when: string;
}
export interface BandSet {
  rules: BandRule[];
  default?: string | null;
}

/** An entry as written in the `yaml julius` block, after YAML parsing. */
export interface RawEntry {
  julius: string;
  entry: string;
  access: "private" | "public";
  origins?: string[];
  model: string;
  accept_uncalibrated?: boolean;
  log: "full" | "answers" | "none";
  retention_days?: number;
  budget: { daily_usd: number; per_ip_per_min?: number };
  shared?: Record<string, string[] | Record<string, string>>;
  sets: Record<string, Record<string, Question & { options?: unknown }>>;
  bands?: Record<string, BandSet>;
  examples?: string;
}

/** A validated, registered entry. Produced by `compileEntry`. */
export interface CompiledEntry {
  slug: string;
  access: "private" | "public";
  origins: string[];
  model: string;
  acceptUncalibrated: boolean;
  log: "full" | "answers" | "none";
  retentionDays: number;
  dailyUsd: number;
  perIpPerMin?: number;
  sets: Record<string, CompiledSet>;
}

export interface CompiledSet {
  name: string;
  /** Questions in entry order, `$shared` resolved. */
  questions: Array<{ id: string; question: Question }>;
  setHash: string;
  bands?: { rules: Array<{ band: string; when: string; expr: BandExpr }>; default: string | null };
}

export type BandExpr =
  | { op: "and" | "or"; left: BandExpr; right: BandExpr }
  | { op: "cmp"; question: string; field: string; cmp: ">" | ">=" | "<" | "<=" | "==" | "!="; value: number | string };

/** What a provider returns for one question, before normalization. */
export interface RawAnswer {
  p?: number;
  probs?: Record<string, number>;
  score?: number;
  confidence?: number;
}

export interface YesNoAnswer { p: number; confidence?: number }
export interface ChoiceAnswer { choice: string; probs: Record<string, number>; confidence?: number }
export interface ScoreAnswer { score: number; level: number; label: string; confidence?: number }
export type Answer = YesNoAnswer | ChoiceAnswer | ScoreAnswer;

export type Status = "ok" | "unavailable" | "over_budget" | "rate_limited" | "rejected";

export interface Envelope {
  status: Status;
  julius: string;
  entry?: string;
  set?: string;
  set_hash?: string;
  provider?: string;
  model?: string;
  calibrated?: boolean;
  answers?: Record<string, Answer>;
  band?: string | null;
  reason?: string;
  retry_after?: number;
  ms: number;
  request_id: string;
}

export interface BatchItemEnvelope extends Partial<Envelope> {
  id: string;
  status: Status;
}

export interface BatchEnvelope {
  status: Status;
  julius: string;
  entry?: string;
  set?: string;
  results?: BatchItemEnvelope[];
  reason?: string;
  retry_after?: number;
  ms: number;
  request_id: string;
}

export type ProviderErrorKind = "timeout" | "down" | "error" | "rate_limited";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message?: string) {
    super(message ?? `provider ${kind}`);
    this.kind = kind;
    this.name = "ProviderError";
  }
}

export interface ProviderLimits {
  maxQuestions: number;
  maxChoiceOptions?: number;
  maxScoreLevels?: number;
  maxStateChars: number;
}

export interface ProviderAdapter {
  name: string;
  calibrated: boolean;
  limits: ProviderLimits;
  supports(model: string): boolean;
  decide(input: {
    model: string;
    state: unknown;
    questions: ExpandedQuestion[];
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ answers: Record<string, RawAnswer>; costUsd: number; inputTokens?: number }>;
}

export interface LogRow {
  id: string;
  ts: number;
  request_id: string;
  item_id?: string;
  entry: string;
  set: string;
  set_hash: string;
  status: Status;
  reason?: string;
  provider?: string;
  model?: string;
  calibrated?: boolean;
  band?: string | null;
  ms: number;
  cost_usd?: number;
  input_tokens?: number;
  answers?: Record<string, Answer>;
  state?: unknown;
}

/** Storage and environment the core depends on. Deciders supply their own. */
export interface Ports {
  entries: { get(slug: string): Promise<CompiledEntry | undefined> | CompiledEntry | undefined };
  /** Returns a key id when the token is valid for the entry, otherwise null. */
  keys: { verify(entry: string, token: string): Promise<string | null> | string | null };
  /** Increments and returns the count for `scope` in the current one-minute window. */
  rateLimit: { hit(scope: string, nowMs: number): Promise<number> | number };
  spend: {
    get(entry: string, day: string): Promise<number> | number;
    add(entry: string, day: string, usd: number): Promise<void> | void;
  };
  kill: { isKilled(entry: string, nowMs: number): Promise<boolean> | boolean };
  log: { write(row: LogRow): Promise<void> | void };
  clock?: { now(): number };
  ids?: { next(): string };
}

export interface DeciderOptions {
  /** Sum of all entries' spend per UTC day that stops every call. Omit for no global cap. */
  globalDailyUsd?: number;
  maxBatchItems?: number;
  /** Items processed at once in a batch. Above 1, budget checks may overshoot. Default 1. */
  batchConcurrency?: number;
  /** Per-key ceiling for private entries. Omit for none. */
  privatePerKeyPerMin?: number;
  timeoutMs?: number;
  /** Overrides the providers' state size limit (smaller wins). */
  maxStateChars?: number;
  /** Per-entry overrides. */
  entryOptions?: (slug: string) => { timeoutMs?: number; maxStateChars?: number } | undefined;
}

export interface HttpRequest {
  path: string;
  headers: Record<string, string | undefined>;
  clientIp: string;
  body?: unknown;
  rawBody?: string;
}
