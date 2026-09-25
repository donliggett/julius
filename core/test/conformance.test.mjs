// Runs the Julius conformance suite against this core with in-memory ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { compileEntry, createDecider, createMemoryPorts, extractJuliusBlock, runConformanceCase } from "../dist/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "conformance");
const NOW = Date.UTC(2026, 0, 15, 12, 0, 5);
const DAY = new Date(NOW).toISOString().slice(0, 10);

const harness = {
  async entryFiles() {
    return (await readdir(join(ROOT, "entries"))).filter((f) => f.endsWith(".md")).sort();
  },
  async loadEntry(file) {
    return parse(extractJuliusBlock(await readFile(join(ROOT, "entries", file), "utf8")));
  },
  async create({ provider, setup }) {
    const mem = createMemoryPorts({ now: () => NOW });
    for (const slug of setup.killed ?? []) mem.kill(slug);
    for (const [slug, usd] of Object.entries(setup.spent_usd ?? {})) mem.addSpend(slug, DAY, usd);
    const decider = createDecider({ ports: mem.ports, providers: [provider], options: { batchConcurrency: 1 } });
    return {
      handle: (req) => decider.handle(req),
      logs: () => mem.logs,
      async register(raw) {
        const r = await compileEntry(raw, provider.limits);
        if (!r.ok) return { ok: false, reason: r.reason };
        mem.addEntry(r.entry);
        if (r.entry.access === "private") mem.addKey(r.entry.slug, `k-${r.entry.slug}`);
        return { ok: true };
      },
    };
  },
};

const files = (await readdir(join(ROOT, "cases"))).filter((f) => f.endsWith(".json")).sort();
for (const f of files) {
  const { group, cases } = JSON.parse(await readFile(join(ROOT, "cases", f), "utf8"));
  for (const c of cases) {
    test(`${group}/${c.id}`, async () => {
      const errors = await runConformanceCase(c, harness);
      assert.deepEqual(errors, [], errors.join("\n"));
    });
  }
}
