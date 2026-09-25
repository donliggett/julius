#!/usr/bin/env python3
"""Check that the conformance fixtures are well formed.

Checks entries (valid ones pass the validator, invalid ones don't), case
structure, references to entries and sets, matcher syntax, scripted replies,
and that every expected set_hash equals the section 8 computation.

Usage: check_fixtures.py   (from any directory; needs Python 3.8+ and PyYAML)
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "skills" / "add-julius" / "scripts"))
import validate as V  # noqa: E402

TYPES = {"string", "number", "integer", "boolean", "object", "array", "null"}
ERRORS = {"timeout", "down", "error", "rate_limited"}
errors = []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def load_entry(path):
    blocks = V.find_block(path.read_text(encoding="utf-8"))
    if len(blocks) != 1:
        return None, None, ["expected one yaml julius block"]
    entry = V.yaml.safe_load(blocks[0])
    r = V.Report()
    sets, _ = V.check_entry(entry, r)
    return entry, sets, r.errors


def check_matchers(obj, where):
    if isinstance(obj, dict):
        special = [k for k in obj if k.startswith("$")]
        if special:
            if len(obj) != 1 or special[0] not in ("$type", "$absent", "$any"):
                err(where, f"bad matcher {obj!r}")
            elif special[0] == "$type" and obj["$type"] not in TYPES:
                err(where, f"unknown $type {obj['$type']!r}")
            return
        for k, v in obj.items():
            check_matchers(v, f"{where}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            check_matchers(v, f"{where}[{i}]")


def main():
    entries = {}
    for f in sorted((HERE / "entries").glob("*.md")):
        e, sets, errs = load_entry(f)
        for x in errs:
            err(f"entries/{f.name}", x)
        if e and not errs:
            if f.stem != e["entry"]:
                err(f"entries/{f.name}", "file name must match the entry slug")
            entries[e["entry"]] = (e, sets)
    for f in sorted((HERE / "entries" / "invalid").glob("*.md")):
        try:
            _, _, errs = load_entry(f)
        except V.yaml.YAMLError:
            errs = ["yaml"]
        if not errs and f.stem != "big-set":
            err(f"entries/invalid/{f.name}", "passes validation but is meant to be rejected")

    seen = set()
    count = 0
    for f in sorted((HERE / "cases").glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        if data.get("suite") != "julius-conformance" or data.get("group") != f.stem:
            err(f.name, "needs suite: julius-conformance and group matching the file name")
        for c in data.get("cases", []):
            count += 1
            w = f"{f.stem}/{c.get('id')}"
            for k in ("id", "section", "description", "steps"):
                if k not in c:
                    err(w, f"missing {k}")
            if c.get("id") in seen:
                err(w, "duplicate case id")
            seen.add(c.get("id"))
            for n, s in enumerate(c.get("steps", [])):
                sw = f"{w} step {n}"
                if "register" in s:
                    if not (HERE / "entries" / s["register"]).exists():
                        err(sw, f"no entry file {s['register']}")
                    continue
                rq, ex = s.get("request"), s.get("expect")
                if not isinstance(rq, dict) or not isinstance(ex, dict) or "body" not in ex:
                    err(sw, "needs request and expect.body")
                    continue
                if rq.get("path") not in ("/v1/decide", "/v1/decide/batch"):
                    err(sw, f"unknown path {rq.get('path')!r}")
                for r in s.get("responses", []):
                    if "error" in r and r["error"] not in ERRORS:
                        err(sw, f"unknown provider error {r['error']!r}")
                    if "error" not in r and not isinstance(r.get("answers"), dict):
                        err(sw, "a response needs answers or error")
                check_matchers(ex, f"{sw} expect")
                body = rq.get("body")
                if isinstance(body, dict) and body.get("entry") in entries and c.get("preload", True):
                    e, sets = entries[body["entry"]]
                    hashes = [ex["body"].get("set_hash")] + [r.get("set_hash") for r in ex["body"].get("results", []) if isinstance(r, dict)]
                    hashes += [row.get("set_hash") for row in ex.get("log", [])]
                    for h in hashes:
                        if isinstance(h, str) and body.get("set") in sets:
                            want = V.set_hash(e["model"], sets[body["set"]])
                            if h != want:
                                err(sw, f"set_hash {h} should be {want}")
    if errors:
        print("\n".join(errors))
        print(f"FAILED: {len(errors)} problem(s)")
        return 1
    print(f"OK: {len(entries)} entries, {count} cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
