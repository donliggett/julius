# Julius Standard — v0.1

Julius is a contract for asking a decision model typed questions about a piece of state and getting back calibrated, machine-readable answers. It defines how a project describes its questions (an **entry**), how it asks them (a **request**), and what it gets back (a **response**).

Julius is implementation-agnostic. A service that implements this contract is called a **decider**. A decider may use any provider or model that can answer Julius question types.

## 1. Principles

1. **The decider is dumb.** It authenticates, validates, calls a provider, applies bands, logs, and enforces budgets. It never builds state and never takes actions.
2. **The project owns state and policy.** The project decides what goes into state and what to do with every answer.
3. **The decider reports; the project decides.** When the decider cannot answer, it says so with a status and a reason. What happens next is written in the project's entry doc, not in the decider.
4. **Provider-agnostic.** Question types are Julius types, not any provider's. Decider adapters map them.
5. **Calibration is explicit.** Every response states whether its probabilities come from a calibrated model.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Entry | One project's registration: its access rules, budget, logging, and question sets. Lives in the project's `JULIUS.md`. |
| Set | A named group of questions asked together against one state. |
| Question | One typed decision: `choice`, `score`, or `yesno`. |
| State | Text or JSON the project sends as context for a set. |
| Band | A named label the decider derives from answers using the entry's rules (e.g. `proceed`, `hold`, `stop`). |
| Decider | A service implementing this standard. |

## 3. Question types

All questions have an `id` (the key in the set), a `type`, and `instructions`.

Identifiers:

| Name | Pattern |
| --- | --- |
| Entry slug | `^[a-z0-9-]+$` |
| Set name | `^[a-z0-9-]+$` |
| Question id | `^[a-z0-9_]+$` |
| Option key | `^[a-z0-9_]+$` |
| `each` item id, batch item id | `^[a-z0-9_-]+$` |

In YAML, quote any id or option key that YAML would read as a boolean or number (`yes`, `no`, `on`, `off`, `true`, `false`, `1`), or pick another name.

Question ids never contain `.`, so dotted names such as `vip.r1` (expanded answers) and `irreversible.p` (band operands) are unambiguous.

### `choice` — which of these options?

```yaml
kind:
  type: choice
  instructions: "Which team should handle this message"
  options:
    billing: "Payment or subscription issues"
    technical: "Bugs or integration problems"
    other: "Anything else"
```

`options` is a map of option key → description, or a list of keys when the keys are self-explanatory. At least 2 options.

### `score` — where on this rubric?

```yaml
difficulty:
  type: score
  instructions: "How much reasoning this request needs"
  levels: ["Template reply", "Short custom reply", "Needs research or judgment"]
```

`levels` is an ordered list, lowest first, at least 2 entries.

### `yesno` — is this true?

```yaml
irreversible:
  type: yesno
  instructions: "The action destroys or overwrites data that cannot be recovered"
  if_true: "Deletes, resets, drops, or force-overwrites stored data"     # optional
  if_false: "Reads data, or makes changes that can be undone"             # optional
```

Phrase `instructions` as a statement to be judged true or false. `if_true` and `if_false` descriptions are optional boundary hints. (They aren't named `true` and `false` because YAML reads those keys as booleans.) The answer `p` is the probability that the statement is true.

### Shared option lists

An entry may define reusable option maps under `shared` and reference them with `$name`:

```yaml
shared:
  actions: { charge: "Close distance now", hunt: "Search last known position" }
sets:
  turn:
    move: { type: choice, options: $actions, instructions: "Best move this turn" }
```

### Expansion with `each`

When the number of subjects varies per request, a question may declare `each: <param>`. The request supplies `params.<param>` as a list of objects, each with an `id` (`^[a-z0-9_-]+$`). The decider asks one copy of the question per item, substituting `{field}` placeholders from that item.

```yaml
vip:
  type: yesno
  each: runners
  instructions: "Runner {id} is the one the other runners are protecting"
```

Request `params: { runners: [{ id: "r1" }, { id: "r2" }] }` produces answers `vip.r1` and `vip.r2`.

Placeholder values must be strings or integers. A request is `rejected` with reason `bad_params` if the list is missing or empty, an item has no valid `id`, ids repeat, a placeholder names a field the item doesn't have, or a value has another type. A literal brace is written `{{` or `}}`.

## 4. Entry schema

An entry is a YAML block inside the project's `JULIUS.md`, fenced with the info string `yaml julius` so a decider can find it.

| Field | Required | Meaning |
| --- | --- | --- |
| `julius` | yes | Standard version, e.g. `"0.1"`. |
| `entry` | yes | Slug, unique within a decider. |
| `access` | yes | `private` (bearer key required) or `public` (no secret; origin-checked and rate-limited). |
| `origins` | if public | Allowed browser origins. A request to a public entry without one of these in its `Origin` header is rejected with `origin_not_allowed`. |
| `model` | yes | Pinned model identifier. Avoid floating aliases such as `latest`. |
| `accept_uncalibrated` | no | Default `false`. If `false`, the decider must never return answers from an uncalibrated source for this entry. |
| `log` | yes | `full` (state + answers), `answers` (answers only), or `none` (metadata only). Metadata is always kept: time, entry, set, `set_hash`, status, reason, `ms`, cost, and `request_id`. |
| `retention_days` | no | How long logged rows are kept. Default 30. |
| `budget` | yes | `daily_usd` (required); `per_ip_per_min` (required for public entries). |
| `shared` | no | Reusable option maps. |
| `sets` | yes | Map of set name → map of question id → question. |
| `bands` | no | Map of set name → band rules (section 5). |
| `examples` | no | Path to a golden-examples file (section 9), relative to `JULIUS.md`. |

How an entry reaches a decider (uploaded, read from the project's repo, submitted to a registry) is up to the decider and outside this standard. A decider rejects an entry whose `julius` version it doesn't implement.

### Budgets and rate limits

- Spend is the cost the provider reports for each call, summed per entry per UTC day.
- Before each provider call, the decider checks the entry's spend for the day. Once it has reached `daily_usd`, the call is refused with `over_budget` / `entry_budget`. A single call may take spend past the limit; the next one is refused.
- `per_ip_per_min` counts requests per client IP in any 60-second window. A batch counts as one request.

## 5. Bands

Bands turn answers into a single label. Rules are evaluated in order; the first match wins. If none match, the set's `default` is returned (or `null` if no default).

```yaml
bands:
  reflex-pretool:
    rules:
      - { band: stop, when: "irreversible.p > 0.7" }
      - { band: hold, when: "intent_mismatch.p > 0.6 or scope.confidence < 0.5" }
    default: proceed
```

Expression grammar (v0.1):

- Operand: `<question_id>.<field>` where field is `p` (yesno), `choice`, `score`, `level`, or `confidence`.
- Operators: `> >= < <= == !=`.
- Values: numbers, or quoted strings for `choice`.
- Combine with `and` / `or`; `and` binds tighter than `or`; parentheses allowed.
- A comparison against a missing field is `false`, including `!=`.
- v0.1 bands may reference only questions without `each`, and only the fields above (not individual `probs`).

Bands are labels, not actions. The project decides what each label means.

## 6. Request

```
POST /v1/decide
Authorization: Bearer <key>        (private entries)
Content-Type: application/json
```

```json
{
  "entry": "ops-agent",
  "set": "reflex-pretool",
  "state": { "task": "…", "plan": "…", "action": "…" },
  "params": {},
  "request_id": "optional-caller-id"
}
```

Batch form, one set across many states:

```
POST /v1/decide/batch
```

```json
{
  "entry": "skill-index",
  "set": "skill-audit",
  "items": [
    { "id": "skill-a", "state": "…", "params": {} },
    { "id": "skill-b", "state": "…" }
  ]
}
```

Request fields: `entry`, `set`, and `state` are required; `params` defaults to `{}`; `request_id` is optional and echoed back (a decider may generate one when it's absent).

A decider must accept at least 50 items per batch. Item ids are unique within the batch.

If the whole batch fails (auth, unknown entry or set, too many items, caller rate limit), the response is one non-`ok` envelope with no `results`. Otherwise the response has `status: "ok"` and a `results` array with one envelope per item, in request order, each carrying its item `id` and its own status. An item can fail on its own, for example `over_budget` when the budget runs out partway through a batch.

```json
{
  "status": "ok",
  "julius": "0.1",
  "entry": "skill-index",
  "set": "skill-audit",
  "results": [
    { "id": "skill-a", "status": "ok", "answers": { "…": {} }, "band": "…" },
    { "id": "skill-b", "status": "over_budget", "reason": "entry_budget" }
  ]
}
```

Item envelopes carry the same fields as a single response (section 7); the example abbreviates them.

## 7. Response envelope

Every response, success or failure, uses this shape. Projects must branch on `status`, not on the HTTP code.

```json
{
  "status": "ok",
  "julius": "0.1",
  "entry": "ops-agent",
  "set": "reflex-pretool",
  "set_hash": "a41f9c2e",
  "provider": "typesafe",
  "model": "jev-1.13",
  "calibrated": true,
  "answers": {
    "irreversible": { "p": 0.82 },
    "scope": { "choice": "side_step", "probs": { "expected": 0.2, "side_step": 0.7, "unrelated": 0.1 }, "confidence": 0.64 }
  },
  "band": "stop",
  "ms": 212,
  "request_id": "…"
}
```

Answer shapes:

| Type | Shape |
| --- | --- |
| `choice` | `{ "choice": key, "probs": { key: number }, "confidence": number }` — `choice` is the key with the highest probability; a tie goes to the option listed first in the entry. |
| `score` | `{ "score": number, "level": int, "label": string, "confidence": number }` — `score` is on the 0-based level scale; `level` is `score` rounded half up (`floor(score + 0.5)`) and clamped to the level range; `label` is `levels[level]`. |
| `yesno` | `{ "p": number }`, plus `confidence` if the provider supplies it. |

`confidence` is present only when the provider supplies it. `probs` for a `choice` covers every option and sums to 1 (within rounding). `band` is present when the set has band rules.

### Statuses

| Status | Meaning | Answers present |
| --- | --- | --- |
| `ok` | Answered. | yes |
| `unavailable` | No acceptable provider answered (down, timeout, or only uncalibrated sources when not accepted). | no |
| `over_budget` | Entry or global daily budget exhausted, or entry is switched off. | no |
| `rate_limited` | Caller exceeded the rate limit. | no |
| `rejected` | Auth failed, unknown entry or set, or the request failed validation. | no |

Non-`ok` responses include `status`, `julius`, `reason` (a short machine code), `ms`, and `request_id`, plus `entry` and `set` as sent. They may include `retry_after` in seconds. They never include `answers` or `band`.

### Check order

When more than one failure applies, the first in this order is reported:

1. The body isn't valid JSON or is missing `entry`, `set`, or `state`: `rejected` / `bad_request`
2. Unknown entry: `rejected` / `unknown_entry`
3. Key or origin check: `rejected` / `auth_failed` or `origin_not_allowed`
4. Caller rate limit: `rate_limited` / `caller_rate_limit`
5. Unknown set: `rejected` / `unknown_set`
6. Params and state size: `rejected` / `bad_params` or `state_too_large`
7. Entry switched off, then budget: `over_budget` / `killed`, `global_budget`, or `entry_budget`
8. No acceptable provider: `unavailable` / `no_calibrated_provider`
9. The provider call itself: `unavailable` / `provider_*`

In a batch, steps 1–5 apply to the whole batch. So do a missing `items` list, an item without a valid `id` or without `state`, and duplicate item ids (`bad_request`), and too many items (`batch_too_large`). Steps 6–9 apply to each item separately.

### Reason codes

| Status | Reasons |
| --- | --- |
| `unavailable` | `provider_down`, `provider_timeout`, `provider_error`, `provider_rate_limited`, `no_calibrated_provider` |
| `over_budget` | `entry_budget`, `global_budget`, `killed` |
| `rate_limited` | `caller_rate_limit` |
| `rejected` | `auth_failed`, `origin_not_allowed`, `unknown_entry`, `unknown_set`, `bad_request`, `bad_params`, `state_too_large`, `batch_too_large`, `set_too_large`, `version_unsupported` |

A decider may add its own reasons prefixed `x_`. Projects branch on `status` first; a reason they don't recognize is handled like any other reason under that status.

### HTTP codes

Suggested mapping, for logs and tooling only: `ok` 200, `rejected` 400 (401 for `auth_failed`, 403 for `origin_not_allowed`), `rate_limited` 429, `over_budget` 402 or 429, `unavailable` 503. The envelope is always the source of truth.

## 8. Versioning

- `julius` in the entry and response identifies the standard version. Before 1.0, any minor version may make breaking changes.
- `set_hash` identifies one set definition on one model. Any edit to a set's questions or a model change produces a new hash; edits to bands, budget, access, or logging do not. Deciders must record `set_hash` with every logged decision so calibration data from different versions is never mixed.
- Computing `set_hash`: resolve `$shared` references, build the object `{"model": <model>, "questions": <resolved set>}`, serialize it as JSON with keys sorted, no insignificant whitespace, and non-ASCII characters written as UTF-8 rather than `\u` escapes, take the SHA-256, and keep the first 8 hex characters. The same entry gives the same hash on any conforming decider.

## 9. Golden examples

An entry may point to a YAML file of known cases used to check behavior after edits or model changes:

```yaml
- set: reflex-pretool
  state: { task: "Add a phone column to contacts", plan: "…", action: "npm run db:reset" }
  expect:
    irreversible: { p_min: 0.7 }
    band: stop
- set: reflex-pretool
  state: { task: "Reset the dev database", plan: "…", action: "npm run db:reset" }
  expect:
    band: [hold, proceed]
```

Each example has `set` and `state`, and optional `params` and `note`. `expect` maps a question id (or an expanded id such as `vip.r1`) to checks: `p_min`, `p_max`, `choice` (key or list of keys), and `level` (int or list). The top-level `band` key takes a label or list of labels.

Examples are run by a decider or a separate checker whenever a set or its model changes. A failing example means the change needs review before it ships.

## 10. Decider conformance

A conforming decider:

1. Validates entries at registration and rejects invalid ones with a reason: `version_unsupported`, `set_too_large` (a set exceeds the provider's limits), or `invalid_entry` (anything else in sections 3–5).
2. Enforces `access`, `origins`, `budget`, and `log` exactly as declared.
3. Never returns uncalibrated answers to an entry with `accept_uncalibrated: false`.
4. Returns the envelope in section 7 for every request, including failures.
5. Never includes state content in error messages.
6. Treats state as opaque data: it is passed to the provider and never interpreted as instructions to the decider.
7. Records `set_hash` with every logged decision.
8. Passes the conformance suite in [`conformance/`](conformance/).

## 11. Security notes

- A `public` entry's origin check only stops other websites' browser pages. Any non-browser client can send any `Origin`, so treat a public entry as callable by anyone and size `budget` and `per_ip_per_min` for that.
- Private-entry keys are issued by the decider, one or more per entry, and should be rotatable without editing the entry.
- With `log: full`, state is stored as sent. Keep secrets and personal data out of state, or use `answers` or `none`.
- State can contain text written by untrusted people. Deciders pass it only as data to the provider, and projects should write questions assuming state may try to steer the answer.
