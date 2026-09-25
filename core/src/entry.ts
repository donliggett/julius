import { parseBandExpr } from "./bands.js";
import { setHash } from "./hash.js";
import type { CompiledEntry, CompiledSet, ProviderLimits, Question } from "./types.js";
import { JULIUS_VERSION } from "./types.js";

const SLUG = /^[a-z0-9-]+$/;
const QID = /^[a-z0-9_]+$/;
const OPT = /^[a-z0-9_]+$/;
const TOP = new Set(["julius", "entry", "access", "origins", "model", "accept_uncalibrated", "log", "retention_days", "budget", "shared", "sets", "bands", "examples"]);
const QKEYS: Record<string, Set<string>> = {
  choice: new Set(["type", "instructions", "options", "each"]),
  score: new Set(["type", "instructions", "levels", "each"]),
  yesno: new Set(["type", "instructions", "if_true", "if_false", "each"]),
};

export type CompileResult =
  | { ok: true; entry: CompiledEntry; warnings: string[] }
  | { ok: false; reason: "version_unsupported" | "invalid_entry" | "set_too_large"; errors: string[]; warnings: string[] };

/**
 * Find the single ```yaml julius block in a JULIUS.md and return its text.
 * YAML parsing is left to the caller so the core has no runtime dependencies.
 */
export function extractJuliusBlock(markdown: string): string {
  const re = /^```yaml julius[ \t]*\r?\n([\s\S]*?)^```/gm;
  const blocks = [...markdown.matchAll(re)].map((m) => m[1]);
  if (blocks.length !== 1) throw new Error(`expected exactly one \`\`\`yaml julius block, found ${blocks.length}`);
  return blocks[0];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPosNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isPosInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;

function checkOptions(opts: unknown, where: string, errors: string[], maxOptions?: number): void {
  let keys: unknown[];
  if (Array.isArray(opts)) keys = opts;
  else if (isObj(opts)) {
    keys = Object.keys(opts);
    for (const [k, v] of Object.entries(opts)) if (typeof v !== "string") errors.push(`${where}.${k}: option description must be a string`);
  } else { errors.push(`${where}: options must be a map of key -> description or a list of keys`); return; }
  if (keys.length < 2) errors.push(`${where}: choice needs at least 2 options`);
  if (new Set(keys.map(String)).size !== keys.length) errors.push(`${where}: duplicate option keys`);
  for (const k of keys) if (typeof k !== "string" || !OPT.test(k)) errors.push(`${where}: option key ${JSON.stringify(k)} must match ${OPT.source}`);
  if (maxOptions !== undefined && keys.length > maxOptions) errors.push(`${where}: ${keys.length} options exceeds the provider limit of ${maxOptions}`);
}

/**
 * Validate a parsed entry and compile it for a decider (Standard sections 3-5 and 10).
 * `limits` are the strictest limits of the providers that will serve this entry.
 */
export async function compileEntry(raw: unknown, limits?: Partial<ProviderLimits>): Promise<CompileResult> {
  const errors: string[] = [], warnings: string[] = [];
  const fail = (reason: "version_unsupported" | "invalid_entry" | "set_too_large"): CompileResult => ({ ok: false, reason, errors, warnings });
  if (!isObj(raw)) { errors.push("entry: the julius block must be a YAML map"); return fail("invalid_entry"); }
  const e = raw;
  if (typeof e.julius !== "string") { errors.push(`julius: must be a quoted string such as "${JULIUS_VERSION}"`); return fail("invalid_entry"); }
  if (e.julius !== JULIUS_VERSION) { errors.push(`julius: version ${e.julius} is not supported (this core implements ${JULIUS_VERSION})`); return fail("version_unsupported"); }
  for (const k of Object.keys(e)) if (!TOP.has(k)) warnings.push(`${k}: unknown top-level field`);
  if (typeof e.entry !== "string" || !SLUG.test(e.entry)) errors.push(`entry: slug must match ${SLUG.source}`);
  if (e.access !== "private" && e.access !== "public") errors.push("access: must be private or public");
  if (typeof e.model !== "string" || !e.model.trim()) errors.push("model: must be a pinned model identifier");
  if (e.accept_uncalibrated !== undefined && typeof e.accept_uncalibrated !== "boolean") errors.push("accept_uncalibrated: must be true or false");
  if (e.log !== "full" && e.log !== "answers" && e.log !== "none") errors.push("log: must be full, answers, or none");
  const rd = e.retention_days ?? 30;
  if (!Number.isInteger(rd) || (rd as number) < 0) errors.push("retention_days: must be a non-negative integer");
  const budget = e.budget;
  if (!isObj(budget) || !isPosNum(budget.daily_usd)) errors.push("budget.daily_usd: must be a positive number");
  if (e.access === "public") {
    if (!isObj(budget) || !isPosInt(budget.per_ip_per_min)) errors.push("budget.per_ip_per_min: required for public entries");
    const o = e.origins;
    if (!Array.isArray(o) || o.length === 0 || !o.every((x) => typeof x === "string" && /^https?:\/\//.test(x))) {
      errors.push("origins: public entries need a list of allowed origins like https://app.example.com");
    }
  }
  const shared = e.shared ?? {};
  if (!isObj(shared)) errors.push("shared: must be a map");
  else for (const [name, opts] of Object.entries(shared)) checkOptions(opts, `shared.${name}`, errors, limits?.maxChoiceOptions);

  const sets: Record<string, CompiledSet> = {};
  const rawSets = e.sets;
  let tooLarge = false;
  if (!isObj(rawSets) || Object.keys(rawSets).length === 0) errors.push("sets: must be a non-empty map of set name -> questions");
  else for (const [sname, qs] of Object.entries(rawSets)) {
    const w = `sets.${sname}`;
    if (!SLUG.test(sname)) { errors.push(`${w}: set name must match ${SLUG.source}`); continue; }
    if (!isObj(qs) || Object.keys(qs).length === 0) { errors.push(`${w}: must be a non-empty map of question id -> question`); continue; }
    if (limits?.maxQuestions !== undefined && Object.keys(qs).length > limits.maxQuestions) {
      tooLarge = true;
      errors.push(`${w}: ${Object.keys(qs).length} questions exceeds the provider limit of ${limits.maxQuestions}`);
    }
    const questions: Array<{ id: string; question: Question }> = [];
    const resolved: Record<string, unknown> = {};
    for (const [qid, q0] of Object.entries(qs)) {
      const qw = `${w}.${qid}`;
      if (!QID.test(qid)) { errors.push(`${qw}: question id must match ${QID.source}`); continue; }
      if (!isObj(q0)) { errors.push(`${qw}: question must be a map`); continue; }
      const q: Record<string, unknown> = { ...q0 };
      const t = q.type;
      if (t !== "choice" && t !== "score" && t !== "yesno") { errors.push(`${qw}: type must be choice, score, or yesno`); continue; }
      for (const k of Object.keys(q)) {
        if (k === "true" || k === "false") errors.push(`${qw}: key ${k} (YAML reads unquoted true/false as booleans; use if_true / if_false)`);
        else if (!QKEYS[t].has(k)) warnings.push(`${qw}: unknown key ${k}`);
      }
      delete q.true; delete q.false;
      if (typeof q.instructions !== "string" || !q.instructions.trim()) errors.push(`${qw}: instructions must be a non-empty string`);
      if (t === "choice") {
        if (typeof q.options === "string" && q.options.startsWith("$")) {
          const ref = q.options.slice(1);
          if (!isObj(shared) || !(ref in shared)) { errors.push(`${qw}: options refers to $${ref}, which is not defined under shared`); continue; }
          q.options = (shared as Record<string, unknown>)[ref];
        } else checkOptions(q.options, `${qw}.options`, errors, limits?.maxChoiceOptions);
      }
      if (t === "score") {
        const lv = q.levels;
        if (!Array.isArray(lv) || lv.length < 2 || !lv.every((x) => typeof x === "string")) errors.push(`${qw}: levels must be a list of at least 2 strings, lowest first`);
      }
      if (t === "yesno") for (const k of ["if_true", "if_false"]) if (k in q && typeof q[k] !== "string") errors.push(`${qw}: ${k} must be a string`);
      if ("each" in q && (typeof q.each !== "string" || !QID.test(q.each))) errors.push(`${qw}: each must name a params list`);
      questions.push({ id: qid, question: q as unknown as Question });
      resolved[qid] = q;
    }
    sets[sname] = { name: sname, questions, setHash: "" };
    if (typeof e.model === "string") sets[sname].setHash = await setHash(e.model, resolved);
  }

  const rawBands = e.bands ?? {};
  if (!isObj(rawBands)) errors.push("bands: must be a map of set name -> band rules");
  else for (const [sname, b] of Object.entries(rawBands)) {
    const w = `bands.${sname}`;
    const set = sets[sname];
    if (!set) { errors.push(`${w}: no set with this name`); continue; }
    if (!isObj(b) || !Array.isArray(b.rules) || b.rules.length === 0) { errors.push(`${w}: needs a non-empty rules list`); continue; }
    const qmap = new Map(set.questions.map((x) => [x.id, x.question]));
    const rules: Array<{ band: string; when: string; expr: any }> = [];
    b.rules.forEach((r: unknown, n: number) => {
      if (!isObj(r) || typeof r.band !== "string" || typeof r.when !== "string") { errors.push(`${w}.rules[${n}]: needs band and when strings`); return; }
      try { rules.push({ band: r.band, when: r.when, expr: parseBandExpr(r.when, qmap) }); }
      catch (x) { errors.push(`${w}.rules[${n}]: when ${JSON.stringify(r.when)}: ${(x as Error).message}`); }
    });
    const def = b.default;
    if (def !== undefined && def !== null && typeof def !== "string") errors.push(`${w}.default: must be a string`);
    set.bands = { rules, default: typeof def === "string" ? def : null };
  }

  if (errors.length) return fail(tooLarge && errors.every((x) => x.includes("exceeds the provider limit")) ? "set_too_large" : "invalid_entry");
  const b = budget as Record<string, unknown>;
  return {
    ok: true,
    warnings,
    entry: {
      slug: e.entry as string,
      access: e.access as "private" | "public",
      origins: (e.origins as string[] | undefined) ?? [],
      model: e.model as string,
      acceptUncalibrated: (e.accept_uncalibrated as boolean | undefined) ?? false,
      log: e.log as "full" | "answers" | "none",
      retentionDays: rd as number,
      dailyUsd: b.daily_usd as number,
      perIpPerMin: b.per_ip_per_min as number | undefined,
      sets,
    },
  };
}
