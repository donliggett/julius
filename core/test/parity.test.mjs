// set_hash parity with the Python validator on the worked example.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { canonicalJson, compileEntry, extractJuliusBlock } from "../dist/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("worked example hashes match the recorded values", async () => {
  const md = await readFile(join(REPO, "examples", "support-inbox", "JULIUS.md"), "utf8");
  const r = await compileEntry(parse(extractJuliusBlock(md)));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.entry.sets["triage"].setHash, "877f67e9");
  assert.equal(r.entry.sets["order-match"].setHash, "0b7d6020");
});

test("canonical JSON sorts keys and keeps non-ASCII", () => {
  assert.equal(canonicalJson({ b: 1, a: ["é", { d: true, c: null }] }), '{"a":["é",{"c":null,"d":true}],"b":1}');
});

test("provider limits on score levels and choice options give set_too_large", async () => {
  const base = { julius: "0.1", entry: "lim", access: "private", model: "m", log: "answers", budget: { daily_usd: 1 } };
  const levels = await compileEntry({ ...base, sets: { s: { u: { type: "score", instructions: "x", levels: ["a", "b", "c"] } } } }, { maxQuestions: 5, maxScoreLevels: 2 });
  assert.equal(levels.ok, false); assert.equal(levels.reason, "set_too_large");
  const opts = await compileEntry({ ...base, sets: { s: { c: { type: "choice", instructions: "x", options: ["a", "b", "c"] } } } }, { maxQuestions: 5, maxChoiceOptions: 2 });
  assert.equal(opts.ok, false); assert.equal(opts.reason, "set_too_large");
  const fine = await compileEntry({ ...base, sets: { s: { u: { type: "score", instructions: "x", levels: ["a", "b"] } } } }, { maxQuestions: 5, maxScoreLevels: 2 });
  assert.equal(fine.ok, true);
});
