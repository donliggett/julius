import type { Answer, ExpandedQuestion, RawAnswer } from "./types.js";

export class BadAnswer extends Error {}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Turn provider answers into Julius answer shapes (Standard section 7).
 * - choice: highest probability; a tie goes to the option listed first in the entry
 * - score: level = floor(score + 0.5) clamped to the level range; label = levels[level]
 * Throws BadAnswer when the provider left a question unanswered or sent the wrong shape.
 */
export function normalizeAnswers(questions: ExpandedQuestion[], raw: Record<string, RawAnswer>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const q of questions) {
    const a = raw?.[q.id];
    if (!a || typeof a !== "object") throw new BadAnswer(`no answer for ${q.id}`);
    const conf = num(a.confidence) ? { confidence: a.confidence } : {};
    if (q.type === "yesno") {
      if (!num(a.p)) throw new BadAnswer(`${q.id}: missing p`);
      out[q.id] = { p: a.p, ...conf };
    } else if (q.type === "choice") {
      const keys = Array.isArray(q.options) ? q.options : Object.keys(q.options);
      if (!a.probs || typeof a.probs !== "object") throw new BadAnswer(`${q.id}: missing probs`);
      let best = keys[0], bestP = -Infinity;
      const probs: Record<string, number> = {};
      for (const k of keys) {
        const p = num(a.probs[k]) ? a.probs[k] : 0;
        probs[k] = p;
        if (p > bestP) { best = k; bestP = p; }
      }
      out[q.id] = { choice: best, probs, ...conf };
    } else {
      if (!num(a.score)) throw new BadAnswer(`${q.id}: missing score`);
      const level = Math.min(Math.max(Math.floor(a.score + 0.5), 0), q.levels.length - 1);
      out[q.id] = { score: a.score, level, label: q.levels[level], ...conf };
    }
  }
  return out;
}
