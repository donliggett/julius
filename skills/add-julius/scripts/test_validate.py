#!/usr/bin/env python3
"""Self-tests for validate.py. Run: python test_validate.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import validate  # noqa: E402

BASE = """julius: "0.1"
entry: demo
access: private
model: provider-model-2026-01
log: answers
budget: { daily_usd: 1 }
sets:
  check:
    risky:
      type: yesno
      instructions: "The action cannot be undone"
    kind:
      type: choice
      instructions: "What kind of request this is"
      options: [bug, feature, other]
bands:
  check:
    rules:
      - { band: stop, when: "risky.p > 0.7" }
    default: go
"""

CASES = [
    # (name, yaml, examples yaml or None, expected error substring or None for pass)
    ("valid base", BASE, None, None),
    ("true/false keys", BASE.replace('"The action cannot be undone"', '"The action cannot be undone"\n      true: "Deletes data"'), None, "read by YAML as bool"),
    ("yes as option key", BASE.replace("[bug, feature, other]", "[yes, no]"), None, "read by YAML as bool"),
    ("unknown band question", BASE.replace("risky.p > 0.7", "danger.p > 0.7"), None, "unknown question"),
    ("wrong band field", BASE.replace("risky.p > 0.7", "risky.level > 1"), None, "isn't a yesno field"),
    ("probability out of range", BASE.replace("risky.p > 0.7", "risky.p > 70"), None, "between 0 and 1"),
    ("choice ordering", BASE.replace('"risky.p > 0.7"', "'kind.choice > \"bug\"'"), None, "only supports == and !="),
    ("bad option in band", BASE.replace('"risky.p > 0.7"', "'kind.choice == \"question\"'"), None, "is not an option"),
    ("dangling operator", BASE.replace("risky.p > 0.7", "risky.p > 0.7 and"), None, "ends early"),
    ("public without origins", BASE.replace("access: private", "access: public"), None, "origins"),
    ("public without per-ip limit", BASE.replace("access: private", "access: public\norigins: [\"https://a.example\"]"), None, "per_ip_per_min"),
    ("unquoted version", BASE.replace('julius: "0.1"', "julius: 0.10"), None, "must be a quoted string"),
    ("unsupported version", BASE.replace('julius: "0.1"', 'julius: "9.9"'), None, "must be one of"),
    ("missing shared", BASE.replace("[bug, feature, other]", "$kinds"), None, "not defined under shared"),
    ("one option", BASE.replace("[bug, feature, other]", "[bug]"), None, "at least 2 options"),
    ("bad set name", BASE.replace("  check:\n    risky", "  Check_Set:\n    risky"), None, "set name must match"),
    ("band on each question",
     BASE.replace('      instructions: "The action cannot be undone"', '      each: items\n      instructions: "Item {id} cannot be undone"'),
     None, "uses each"),
    ("examples ok",
     BASE + "examples: ex.yaml\n",
     "- set: check\n  state: 'rm -rf /data'\n  expect:\n    risky: { p_min: 0.8 }\n    band: stop\n"
     "- set: check\n  state: 'ls'\n  expect:\n    band: go\n", None),
    ("example unknown band",
     BASE + "examples: ex.yaml\n",
     "- set: check\n  state: 'x'\n  expect:\n    band: halt\n", "not produced by set"),
    ("example wrong check",
     BASE + "examples: ex.yaml\n",
     "- set: check\n  state: 'x'\n  expect:\n    kind: { p_min: 0.5 }\n", "isn't a check for choice"),
    ("example missing each field",
     BASE.replace('      instructions: "The action cannot be undone"', '      each: items\n      instructions: "Item {id} ({name}) cannot be undone"')
         .replace('"risky.p > 0.7"', "'kind.choice == \"bug\"'") + "examples: ex.yaml\n",
     "- set: check\n  state: 'x'\n  params:\n    items: [{ id: a1 }]\n  expect:\n    risky.a1: { p_max: 0.2 }\n", "has no field 'name'"),
]


def run(yaml_text, examples):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "JULIUS.md"
        p.write_text("# Entry\n\n```yaml julius\n" + yaml_text + "```\n", encoding="utf-8")
        if examples is not None:
            (Path(d) / "ex.yaml").write_text(examples, encoding="utf-8")
        entry = validate.yaml.safe_load(yaml_text)
        r = validate.Report()
        sets, bands = validate.check_entry(entry, r)
        if entry.get("examples"):
            validate.check_examples(Path(d) / entry["examples"], sets, bands, r)
        return r


def main():
    failed = 0
    for name, y, ex, expect in CASES:
        r = run(y, ex)
        joined = "\n".join(r.errors)
        if expect is None:
            ok = not r.errors
        else:
            ok = expect in joined
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"\n      errors: {r.errors}"))
    print(f"{len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
