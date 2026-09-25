#!/usr/bin/env python3
"""Validate a Julius entry (JULIUS.md) against the Julius Standard v0.1.

Usage:
    validate.py path/to/JULIUS.md

Checks the fenced `yaml julius` block (fields, identifiers, question types,
$shared references, `each` placeholders, band rule grammar), the golden
examples file if the entry points to one, and prints each set's set_hash.

Exit code 0 when there are no errors (warnings are allowed), 1 otherwise.
Requires Python 3.8+ and PyYAML (pip install pyyaml).
"""
import hashlib
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

VERSIONS = {"0.1"}
ENTRY_RE = re.compile(r"^[a-z0-9-]+$")
SET_RE = re.compile(r"^[a-z0-9-]+$")
QID_RE = re.compile(r"^[a-z0-9_]+$")
OPT_RE = re.compile(r"^[a-z0-9_]+$")
ITEM_RE = re.compile(r"^[a-z0-9_-]+$")
TYPES = {"choice", "score", "yesno"}
QUESTION_KEYS = {
    "choice": {"type", "instructions", "options", "each"},
    "score": {"type", "instructions", "levels", "each"},
    "yesno": {"type", "instructions", "if_true", "if_false", "each"},
}
ENTRY_KEYS = {"julius", "entry", "access", "origins", "model", "accept_uncalibrated",
              "log", "retention_days", "budget", "shared", "sets", "bands", "examples"}
BAND_FIELDS = {"yesno": {"p", "confidence"}, "choice": {"choice", "confidence"},
               "score": {"score", "level", "confidence"}}
FLOATING = re.compile(r"(^|[-_/:@.])(latest|default|stable|current)($|[-_/:@.])", re.I)
PLACEHOLDER = re.compile(r"<[^<>\n]+>")


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def find_block(text):
    blocks = re.findall(r"^```yaml julius[ \t]*\n(.*?)^```", text, re.S | re.M)
    return blocks


def key_trap(key):
    """YAML turned an unquoted key into a bool/int/float/None."""
    return not isinstance(key, str)


def walk_placeholders(obj, path, r):
    if isinstance(obj, str):
        if PLACEHOLDER.search(obj):
            r.warn(path, f"looks like an unfilled placeholder: {obj!r}")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and PLACEHOLDER.search(k):
                r.warn(f"{path}.{k}", "key looks like an unfilled placeholder")
            walk_placeholders(v, f"{path}.{k}", r)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk_placeholders(v, f"{path}[{i}]", r)


def check_options(opts, where, r):
    if isinstance(opts, list):
        keys = opts
    elif isinstance(opts, dict):
        keys = list(opts.keys())
        for k, v in opts.items():
            if not isinstance(v, str):
                r.err(f"{where}.{k}", "option description must be a string")
    else:
        r.err(where, "options must be a map of key -> description or a list of keys")
        return
    if len(keys) < 2:
        r.err(where, "choice needs at least 2 options")
    if len(set(map(str, keys))) != len(keys):
        r.err(where, "duplicate option keys")
    for k in keys:
        if key_trap(k):
            r.err(where, f"option key {k!r} was read by YAML as {type(k).__name__}; quote it or rename it")
        elif not OPT_RE.match(k):
            r.err(where, f"option key {k!r} must match {OPT_RE.pattern}")


def placeholders_in(text):
    stripped = text.replace("{{", "").replace("}}", "")
    return re.findall(r"\{([^{}]*)\}", stripped)


def resolve_sets(entry, r):
    shared = entry.get("shared") or {}
    if not isinstance(shared, dict):
        r.err("shared", "must be a map")
        shared = {}
    for name, opts in shared.items():
        check_options(opts, f"shared.{name}", r)
    sets = entry.get("sets")
    if not isinstance(sets, dict) or not sets:
        r.err("sets", "must be a non-empty map of set name -> questions")
        return {}
    resolved = {}
    for sname, qs in sets.items():
        w = f"sets.{sname}"
        if key_trap(sname) or not SET_RE.match(sname):
            r.err(w, f"set name must match {SET_RE.pattern}")
            continue
        if not isinstance(qs, dict) or not qs:
            r.err(w, "must be a non-empty map of question id -> question")
            continue
        resolved[sname] = {}
        for qid, q in qs.items():
            qw = f"{w}.{qid}"
            if key_trap(qid):
                r.err(qw, f"question id was read by YAML as {type(qid).__name__}; quote it or rename it")
                continue
            if not QID_RE.match(qid):
                r.err(qw, f"question id must match {QID_RE.pattern}")
                continue
            if not isinstance(q, dict):
                r.err(qw, "question must be a map")
                continue
            q = dict(q)
            bad_keys = [k for k in q if key_trap(k)]
            for k in bad_keys:
                hint = " (use if_true / if_false)" if isinstance(k, bool) else ""
                r.err(qw, f"key {k!r} was read by YAML as {type(k).__name__}{hint}")
                del q[k]
            t = q.get("type")
            if t not in TYPES:
                r.err(qw, f"type must be one of {sorted(TYPES)}")
                continue
            extra = set(q) - QUESTION_KEYS[t]
            if extra:
                r.warn(qw, f"unknown keys for {t}: {sorted(extra)}")
            ins = q.get("instructions")
            if not isinstance(ins, str) or not ins.strip():
                r.err(qw, "instructions must be a non-empty string")
            if t == "choice":
                opts = q.get("options")
                if isinstance(opts, str) and opts.startswith("$"):
                    ref = opts[1:]
                    if ref not in shared:
                        r.err(qw, f"options refers to ${ref}, which is not defined under shared")
                        continue
                    q["options"] = shared[ref]
                else:
                    check_options(opts, f"{qw}.options", r)
            if t == "score":
                lv = q.get("levels")
                if not isinstance(lv, list) or len(lv) < 2 or not all(isinstance(x, str) for x in lv):
                    r.err(qw, "levels must be a list of at least 2 strings, lowest first")
            if t == "yesno":
                for k in ("if_true", "if_false"):
                    if k in q and not isinstance(q[k], str):
                        r.err(qw, f"{k} must be a string")
                if isinstance(ins, str) and ins.rstrip().endswith("?"):
                    r.warn(qw, "yesno instructions should be a statement to judge true or false, not a question")
            if "each" in q:
                if not isinstance(q["each"], str) or not QID_RE.match(q["each"]):
                    r.err(qw, "each must name a params list, e.g. each: items")
            elif isinstance(ins, str) and placeholders_in(ins):
                r.warn(qw, "instructions contain {placeholders} but the question has no each")
            if isinstance(ins, str) and "each" in q:
                for f in placeholders_in(ins):
                    if not re.match(r"^[a-z0-9_]+$", f):
                        r.err(qw, f"placeholder {{{f}}} is not a valid field name (write literal braces as {{{{ }}}})")
            resolved[sname][qid] = q
    return resolved


TOKEN = re.compile(r'\s*(\(|\)|>=|<=|==|!=|>|<|and\b|or\b|"[^"]*"|-?\d+(?:\.\d+)?|[a-z0-9_]+\.[a-z]+)')


def check_expr(expr, qs):
    toks, pos = [], 0
    expr = expr.rstrip()
    while pos < len(expr):
        m = TOKEN.match(expr, pos)
        if not m:
            raise ValueError(f"can't parse near {expr[pos:]!r}")
        toks.append(m.group(1))
        pos = m.end()
    i = 0

    def peek():
        return toks[i] if i < len(toks) else None

    def take():
        nonlocal i
        if i >= len(toks):
            raise ValueError("expression ends early")
        i += 1
        return toks[i - 1]

    def or_expr():
        and_expr()
        while peek() == "or":
            take()
            and_expr()

    def and_expr():
        atom()
        while peek() == "and":
            take()
            atom()

    def atom():
        if peek() == "(":
            take()
            or_expr()
            if take() != ")":
                raise ValueError("missing )")
            return
        operand = take()
        if "." not in operand:
            raise ValueError(f"expected <question>.<field>, got {operand!r}")
        qid, field = operand.split(".", 1)
        if qid not in qs:
            raise ValueError(f"unknown question {qid!r}")
        q = qs[qid]
        if "each" in q:
            raise ValueError(f"{qid!r} uses each; v0.1 bands can't reference it")
        if field not in BAND_FIELDS[q["type"]]:
            raise ValueError(f"{qid}.{field} isn't a {q['type']} field (allowed: {sorted(BAND_FIELDS[q['type']])})")
        op = take()
        if op not in (">", ">=", "<", "<=", "==", "!="):
            raise ValueError(f"expected a comparison operator after {operand}, got {op!r}")
        val = take()
        if field == "choice":
            if not val.startswith('"'):
                raise ValueError(f"{operand} compares to a quoted option key")
            if op not in ("==", "!="):
                raise ValueError(f"{operand} only supports == and !=")
            opts = q["options"]
            keys = opts if isinstance(opts, list) else list(opts)
            if val.strip('"') not in keys:
                raise ValueError(f"{val} is not an option of {qid!r}")
        elif val.startswith('"'):
            raise ValueError(f"{operand} compares to a number")
        elif field == "level" and not 0 <= float(val) <= len(q["levels"]) - 1:
            raise ValueError(f"{operand} {op} {val} is outside the level range 0..{len(q['levels']) - 1}")
        elif field in ("p", "confidence") and not 0 <= float(val) <= 1:
            raise ValueError(f"{operand} {op} {val}: probabilities are between 0 and 1")

    or_expr()
    if i != len(toks):
        raise ValueError(f"unexpected {toks[i]!r}")


def check_bands(entry, sets, r):
    bands = entry.get("bands") or {}
    if not isinstance(bands, dict):
        r.err("bands", "must be a map of set name -> band rules")
        return {}
    names = {}
    for sname, b in bands.items():
        w = f"bands.{sname}"
        if sname not in sets:
            r.err(w, "no set with this name")
            continue
        if not isinstance(b, dict) or not isinstance(b.get("rules"), list) or not b["rules"]:
            r.err(w, "needs a non-empty rules list")
            continue
        names[sname] = set()
        for n, rule in enumerate(b["rules"]):
            rw = f"{w}.rules[{n}]"
            if not isinstance(rule, dict) or not isinstance(rule.get("band"), str) or not isinstance(rule.get("when"), str):
                r.err(rw, "each rule needs band (string) and when (string)")
                continue
            names[sname].add(rule["band"])
            try:
                check_expr(rule["when"], sets[sname])
            except ValueError as x:
                r.err(rw, f"when {rule['when']!r}: {x}")
            if "confidence" in rule["when"]:
                r.warn(rw, "confidence is only present when the provider supplies it; if missing, that comparison is false")
        if b.get("default") is not None:
            names[sname].add(b["default"])
        else:
            r.warn(w, "no default; the band will be null when no rule matches")
    return names


def check_entry(entry, r):
    if not isinstance(entry, dict):
        r.err("entry", "the julius block must be a YAML map")
        return {}, {}
    for k in entry:
        if k not in ENTRY_KEYS:
            r.warn(str(k), "unknown top-level field")
    ver = entry.get("julius")
    if not isinstance(ver, str):
        r.err("julius", f"must be a quoted string such as \"0.1\" (YAML read {ver!r} as {type(ver).__name__})")
    elif ver not in VERSIONS:
        r.err("julius", f"must be one of {sorted(VERSIONS)}")
    if not isinstance(entry.get("entry"), str) or not ENTRY_RE.match(entry["entry"]):
        r.err("entry", f"slug must match {ENTRY_RE.pattern}")
    access = entry.get("access")
    if access not in ("private", "public"):
        r.err("access", "must be private or public")
    model = entry.get("model")
    if not isinstance(model, str) or not model.strip():
        r.err("model", "must be a pinned model identifier")
    elif FLOATING.search(model):
        r.warn("model", f"{model!r} looks like a floating alias; pin an exact model version")
    if not isinstance(entry.get("accept_uncalibrated", False), bool):
        r.err("accept_uncalibrated", "must be true or false")
    if entry.get("log") not in ("full", "answers", "none"):
        r.err("log", "must be full, answers, or none")
    rd = entry.get("retention_days", 30)
    if not isinstance(rd, int) or isinstance(rd, bool) or rd < 0:
        r.err("retention_days", "must be a non-negative integer")
    budget = entry.get("budget")
    if not isinstance(budget, dict):
        r.err("budget", "required, with daily_usd")
    else:
        d = budget.get("daily_usd")
        if not isinstance(d, (int, float)) or isinstance(d, bool) or d <= 0:
            r.err("budget.daily_usd", "must be a positive number")
        if access == "public":
            p = budget.get("per_ip_per_min")
            if not isinstance(p, int) or isinstance(p, bool) or p <= 0:
                r.err("budget.per_ip_per_min", "required for public entries")
    if access == "public":
        o = entry.get("origins")
        if not isinstance(o, list) or not o or not all(isinstance(x, str) and x.startswith(("https://", "http://")) for x in o):
            r.err("origins", "public entries need a list of allowed origins like https://app.example.com")
        if entry.get("log") == "full":
            r.warn("log", "public entry with log: full stores whatever anyone sends")
    elif "origins" in entry:
        r.warn("origins", "only used by public entries")
    walk_placeholders(entry, "entry", r)
    sets = resolve_sets(entry, r)
    bands = check_bands(entry, sets, r)
    return sets, bands


def as_list(v):
    return v if isinstance(v, list) else [v]


def check_examples(path, sets, bands, r):
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        r.err("examples", f"file not found: {path}")
        return 0
    except yaml.YAMLError as x:
        r.err("examples", f"YAML error: {x}")
        return 0
    if not isinstance(data, list) or not data:
        r.err("examples", "must be a non-empty YAML list")
        return 0
    covered = {s: set() for s in bands}
    for n, ex in enumerate(data):
        w = f"examples[{n}]"
        if not isinstance(ex, dict):
            r.err(w, "must be a map")
            continue
        sname = ex.get("set")
        if sname not in sets:
            r.err(w, f"unknown set {sname!r}")
            continue
        qs = sets[sname]
        if "state" not in ex:
            r.err(w, "missing state")
        params = ex.get("params") or {}
        for qid, q in qs.items():
            if "each" in q:
                items = params.get(q["each"])
                if not isinstance(items, list) or not items:
                    r.err(w, f"set asks {qid!r} for each {q['each']!r} but params.{q['each']} is missing or empty")
                    continue
                ids = []
                for it in items:
                    if not isinstance(it, dict) or not isinstance(it.get("id"), str) or not ITEM_RE.match(it["id"]):
                        r.err(w, f"every params.{q['each']} item needs an id matching {ITEM_RE.pattern}")
                        continue
                    ids.append(it["id"])
                    for f in placeholders_in(q["instructions"]):
                        if f not in it:
                            r.err(w, f"item {it['id']!r} has no field {f!r} used by {qid!r}")
                if len(ids) != len(set(ids)):
                    r.err(w, f"duplicate ids in params.{q['each']}")
        expect = ex.get("expect")
        if not isinstance(expect, dict) or not expect:
            r.err(w, "missing expect")
            continue
        for key, chk in expect.items():
            if key == "band":
                if sname not in bands:
                    r.err(w, f"expects a band but set {sname!r} has no band rules")
                    continue
                for b in as_list(chk):
                    if b not in bands[sname]:
                        r.err(w, f"band {b!r} is not produced by set {sname!r}")
                    covered[sname].add(b)
                continue
            base, _, item = str(key).partition(".")
            if base not in qs:
                r.err(w, f"unknown question {key!r}")
                continue
            q = qs[base]
            if "each" in q and not item:
                r.err(w, f"{base!r} uses each; expect {base}.<item id>")
                continue
            if "each" not in q and item:
                r.err(w, f"{base!r} doesn't use each; drop .{item}")
                continue
            if item:
                ids = [it.get("id") for it in (params.get(q["each"]) or []) if isinstance(it, dict)]
                if item not in ids:
                    r.err(w, f"{key!r}: no item {item!r} in params.{q['each']}")
            if not isinstance(chk, dict):
                r.err(w, f"{key}: expected a map of checks")
                continue
            allowed = {"yesno": {"p_min", "p_max"}, "choice": {"choice"}, "score": {"level"}}[q["type"]]
            for ck, cv in chk.items():
                if ck not in allowed:
                    r.err(w, f"{key}: {ck!r} isn't a check for {q['type']} (allowed: {sorted(allowed)})")
                elif ck in ("p_min", "p_max") and not (isinstance(cv, (int, float)) and 0 <= cv <= 1):
                    r.err(w, f"{key}.{ck} must be between 0 and 1")
                elif ck == "choice":
                    keys = q["options"] if isinstance(q["options"], list) else list(q["options"])
                    for c in as_list(cv):
                        if c not in keys:
                            r.err(w, f"{key}: {c!r} is not an option")
                elif ck == "level":
                    for c in as_list(cv):
                        if not isinstance(c, int) or not 0 <= c < len(q["levels"]):
                            r.err(w, f"{key}: level {c!r} is out of range")
            if "p_min" in chk and "p_max" in chk and chk["p_min"] > chk["p_max"]:
                r.err(w, f"{key}: p_min is greater than p_max")
    for sname, seen in covered.items():
        missing = bands[sname] - seen
        if missing:
            r.warn(f"examples ({sname})", f"no example expects band(s): {sorted(missing)}")
    for sname in sets:
        if not any(isinstance(ex, dict) and ex.get("set") == sname for ex in data):
            r.warn(f"examples ({sname})", "no examples for this set")
    return len(data)


def set_hash(model, questions):
    obj = {"model": model, "questions": questions}
    s = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:8]


def main(argv):
    if len(argv) != 2 or argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return 0 if len(argv) == 2 else 2
    path = Path(argv[1])
    r = Report()
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as x:
        print(f"ERROR: can't read {path}: {x}")
        return 1
    blocks = find_block(text)
    if len(blocks) != 1:
        print(f"ERROR: expected exactly one ```yaml julius block in {path}, found {len(blocks)}")
        return 1
    try:
        entry = yaml.safe_load(blocks[0])
    except yaml.YAMLError as x:
        print(f"ERROR: YAML error in the julius block: {x}")
        return 1
    sets, bands = check_entry(entry, r)
    n_examples = None
    if isinstance(entry, dict) and entry.get("examples"):
        n_examples = check_examples(path.parent / entry["examples"], sets, bands, r)
    else:
        r.warn("examples", "no golden examples file; add one so edits and model changes can be checked")

    print(f"Julius entry: {path}")
    for w in r.warnings:
        print(f"  WARN  {w}")
    for e in r.errors:
        print(f"  ERROR {e}")
    if r.errors:
        print(f"FAILED: {len(r.errors)} error(s), {len(r.warnings)} warning(s)")
        return 1
    model = entry.get("model")
    print(f"OK: {len(sets)} set(s)" + (f", {n_examples} example(s)" if n_examples else "") + f", {len(r.warnings)} warning(s)")
    for sname, qs in sets.items():
        print(f"  set_hash {sname}: {set_hash(model, qs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
