import type { CompiledSet, ExpandedQuestion } from "./types.js";

const ITEM_ID = /^[a-z0-9_-]+$/;

export class BadParams extends Error {}

function fill(template: string, item: Record<string, unknown>): string {
  const L = "\u0000", R = "\u0001";
  const masked = template.split("{{").join(L).split("}}").join(R);
  const out = masked.replace(/\{([^{}]*)\}/g, (_, field: string) => {
    if (!(field in item)) throw new BadParams(`missing field ${field}`);
    const v = item[field];
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isInteger(v)) return String(v);
    throw new BadParams(`field ${field} must be a string or integer`);
  });
  return out.split(L).join("{").split(R).join("}");
}

/**
 * Expand a set's questions for a request (Standard section 3): entry order, then params order.
 * Throws BadParams when params don't satisfy the set's `each` declarations.
 */
export function expandQuestions(set: CompiledSet, params: unknown): ExpandedQuestion[] {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p !== "object" || Array.isArray(p)) throw new BadParams("params must be an object");
  const out: ExpandedQuestion[] = [];
  for (const { id, question } of set.questions) {
    const { each, ...rest } = question as typeof question & { each?: string };
    if (each === undefined) {
      out.push({ id, ...rest } as ExpandedQuestion);
      continue;
    }
    const items = p[each];
    if (!Array.isArray(items) || items.length === 0) throw new BadParams(`params.${each} must be a non-empty list`);
    const seen = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadParams("items must be objects");
      const itemId = (item as Record<string, unknown>).id;
      if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) throw new BadParams("bad item id");
      if (seen.has(itemId)) throw new BadParams("duplicate item id");
      seen.add(itemId);
      out.push({ id: `${id}.${itemId}`, ...rest, instructions: fill(question.instructions, item as Record<string, unknown>) } as ExpandedQuestion);
    }
  }
  return out;
}
