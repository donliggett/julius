import type { Answer, BandExpr, Question } from "./types.js";

const TOKEN = /\s*(\(|\)|>=|<=|==|!=|>|<|and\b|or\b|"[^"]*"|-?\d+(?:\.\d+)?|[a-z0-9_]+\.[a-z]+)/y;
const FIELDS: Record<Question["type"], string[]> = {
  yesno: ["p", "confidence"],
  choice: ["choice", "confidence"],
  score: ["score", "level", "confidence"],
};
type Cmp = ">" | ">=" | "<" | "<=" | "==" | "!=";
const CMPS = new Set([">", ">=", "<", "<=", "==", "!="]);

/**
 * Parse a band `when` expression (Standard section 5) and check it against the set's questions.
 * `and` binds tighter than `or`. Throws Error with a readable message on any problem.
 */
export function parseBandExpr(expr: string, questions: Map<string, Question>): BandExpr {
  const toks: string[] = [];
  const src = expr.trimEnd();
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`can't parse near ${JSON.stringify(src.slice(pos))}`);
    toks.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  let i = 0;
  const peek = () => toks[i];
  const take = () => {
    if (i >= toks.length) throw new Error("expression ends early");
    return toks[i++];
  };
  const orExpr = (): BandExpr => {
    let left = andExpr();
    while (peek() === "or") { take(); left = { op: "or", left, right: andExpr() }; }
    return left;
  };
  const andExpr = (): BandExpr => {
    let left = atom();
    while (peek() === "and") { take(); left = { op: "and", left, right: atom() }; }
    return left;
  };
  const atom = (): BandExpr => {
    if (peek() === "(") {
      take();
      const inner = orExpr();
      if (take() !== ")") throw new Error("missing )");
      return inner;
    }
    const operand = take();
    const dot = operand.indexOf(".");
    if (dot < 0) throw new Error(`expected <question>.<field>, got ${JSON.stringify(operand)}`);
    const qid = operand.slice(0, dot), field = operand.slice(dot + 1);
    const q = questions.get(qid);
    if (!q) throw new Error(`unknown question ${JSON.stringify(qid)}`);
    if (q.each !== undefined) throw new Error(`${JSON.stringify(qid)} uses each; v0.1 bands can't reference it`);
    if (!FIELDS[q.type].includes(field)) throw new Error(`${qid}.${field} isn't a ${q.type} field`);
    const cmp = take();
    if (!CMPS.has(cmp)) throw new Error(`expected a comparison after ${operand}, got ${JSON.stringify(cmp)}`);
    const raw = take();
    let value: number | string;
    if (field === "choice") {
      if (!raw.startsWith('"')) throw new Error(`${operand} compares to a quoted option key`);
      if (cmp !== "==" && cmp !== "!=") throw new Error(`${operand} only supports == and !=`);
      value = raw.slice(1, -1);
      const opts = q.type === "choice" ? (Array.isArray(q.options) ? q.options : Object.keys(q.options)) : [];
      if (!opts.includes(value)) throw new Error(`${raw} is not an option of ${JSON.stringify(qid)}`);
    } else {
      if (raw.startsWith('"')) throw new Error(`${operand} compares to a number`);
      value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`bad number ${raw}`);
      if ((field === "p" || field === "confidence") && (value < 0 || value > 1)) {
        throw new Error(`${operand} ${cmp} ${raw}: probabilities are between 0 and 1`);
      }
      if (field === "level" && q.type === "score" && (value < 0 || value > q.levels.length - 1)) {
        throw new Error(`${operand} ${cmp} ${raw} is outside the level range 0..${q.levels.length - 1}`);
      }
    }
    return { op: "cmp", question: qid, field, cmp: cmp as Cmp, value };
  };
  const tree = orExpr();
  if (i !== toks.length) throw new Error(`unexpected ${JSON.stringify(toks[i])}`);
  return tree;
}

/** Evaluate a parsed expression. A comparison against a missing field is false, including `!=`. */
export function evaluateBandExpr(expr: BandExpr, answers: Record<string, Answer>): boolean {
  if (expr.op !== "cmp") {
    return expr.op === "and"
      ? evaluateBandExpr(expr.left, answers) && evaluateBandExpr(expr.right, answers)
      : evaluateBandExpr(expr.left, answers) || evaluateBandExpr(expr.right, answers);
  }
  const a = answers[expr.question] as unknown as Record<string, unknown> | undefined;
  if (!a || !(expr.field in a) || a[expr.field] === undefined || a[expr.field] === null) return false;
  const x = a[expr.field] as number | string;
  const v = expr.value;
  switch (expr.cmp) {
    case "==": return x === v;
    case "!=": return x !== v;
    case ">": return (x as number) > (v as number);
    case ">=": return (x as number) >= (v as number);
    case "<": return (x as number) < (v as number);
    case "<=": return (x as number) <= (v as number);
  }
  return false;
}

/** First matching rule wins; otherwise the default (or null). */
export function pickBand(
  bands: { rules: Array<{ band: string; expr: BandExpr }>; default: string | null },
  answers: Record<string, Answer>,
): string | null {
  for (const r of bands.rules) if (evaluateBandExpr(r.expr, answers)) return r.band;
  return bands.default;
}
