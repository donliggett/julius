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
