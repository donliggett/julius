# Julius conformance suite

Language-neutral test cases for deciders. A decider that passes every case here meets section 10 of the [standard](../STANDARD.md).

The suite describes behavior only: requests, what a mock provider returns, and the expected envelopes, logs, and provider calls. Each decider supplies a small harness that runs the cases against its own code.

> **Status:** draft for Julius Standard v0.1.

## Layout

| Path | Contents |
| --- | --- |
| `entries/*.md` | Test entries, in `JULIUS.md` format. Registered before each case unless it says otherwise. |
| `entries/invalid/*.md` | Entries that registration must reject. |
| `cases/*.json` | Test cases, one file per group. |
| `check_fixtures.py` | Checks that the fixtures themselves are well formed. For suite maintainers. |

| Group | Covers |
| --- | --- |
| `envelope` | Envelope fields, derived `choice` / `level` / `label`, `confidence`, `$shared`, `request_id` |
| `set-hash` | What changes `set_hash` and what doesn't |
| `bands` | First match wins, `and`/`or` precedence, missing fields, defaults |
| `each` | Expansion order, placeholders, `{{ }}`, `bad_params` |
| `statuses` | Every status and reason, check order, no state in errors, calibration |
| `access` | Keys, origins, per-IP rate limits |
| `budget` | Daily spend limits |
| `batch` | Result order, per-item failures, whole-batch failures, 50 items |
| `logging` | `full`, `answers`, `none`, and failure rows |
| `registration` | Entries that must be accepted or rejected |

## What a harness provides

For each case, the harness builds a fresh decider with:

1. **A mock provider** with id `mock` in place of any real one. It follows the contract below.
2. **The test entries.** Unless the case has `"preload": false`, register every `entries/*.md` (not `invalid/`) before the first step. Each private entry `<slug>` accepts exactly one key, `k-<slug>`.
3. **The case's `setup`**, if any:
   - `killed`: entry slugs switched off
   - `spent_usd`: `{ slug: amount }` already spent today
4. **One fixed clock.** All steps in a case happen within the same minute and the same UTC day.
5. **Batch items one at a time.** Budget cases expect items to be checked in order, so run batches with a concurrency of 1 under the harness.

Then it runs the steps in order, against the same decider instance.

### Mock provider contract

The mock stands in for a provider adapter, so the core's behavior can be tested without a real model.

- **Limits** start at `{ "calibrated": true, "max_questions": 20, "max_state_chars": 2000 }` and are overridden by the case's `provider` object. `max_questions` counts a set's questions before `each` expansion. `max_state_chars` is compared with the length of the state serialized as compact JSON.
- **One call per state.** The decider makes at most one call per request, or per batch item. A call receives:
  ```json
  { "model": "mock-model-1", "state": { … }, "questions": [ … ] }
  ```
  `questions` lists the set's questions in entry order. Each has `id`, `type`, `instructions`, and the type's fields (`options`, `levels`, `if_true`, `if_false`), with `$shared` resolved. An `each` question appears once per item in params order, with id `<question>.<item id>` and placeholders filled in. `each` itself is not passed on.
- **Scripted replies.** A step's `responses` are returned in order, one per call:
  - `{ "answers": { … }, "cost_usd": 0.01 }`. Answers are keyed by question id and contain only what a provider supplies: `p` for `yesno`, `probs` for `choice`, `score` for `score`, plus `confidence` when present. The decider derives `choice`, `level`, and `label` (section 7).
  - `{ "error": "timeout" | "down" | "error" | "rate_limited", "cost_usd"?: 0.01 }`, mapped to `unavailable` with `provider_timeout`, `provider_down`, `provider_error`, or `provider_rate_limited`. A `cost_usd` on an error means the provider billed the failed call; it counts toward spend.
- A call with no scripted reply left fails the case, and so does a scripted reply left unused.

## Case format

```json
{
  "id": "band-first-match-wins",
  "section": "5",
  "description": "Several rules match; the first one listed wins.",
  "preload": true,
  "setup": { "killed": [], "spent_usd": {} },
  "provider": { "calibrated": true },
  "steps": [
    {
      "request": {
        "path": "/v1/decide",
        "client_ip": "203.0.113.10",
        "headers": { "Authorization": "Bearer k-conf-private" },
        "body": { "entry": "conf-private", "set": "triage", "state": { … } }
      },
      "responses": [ { "answers": { … }, "cost_usd": 0.001 } ],
      "expect": {
        "body": { "status": "ok", "band": "stop" },
        "body_excludes": [],
        "provider_calls": 1,
        "log": []
      }
    }
  ]
}
```

- `request.raw_body` replaces `body` when the test needs a body that isn't valid JSON.
- A registration step is `{ "register": "invalid/big-set.md", "expect": { "ok": false, "reason": "set_too_large" } }`. The harness reports registration as `{ "ok": true }` or `{ "ok": false, "reason": … }`, with reasons from section 10.
- Every `expect` key is optional except `body`.

### Matching rules

- **`body`** is a subset match: every key in the expectation must be present in the response with a matching value, and the response may have more keys. Objects match recursively. Arrays must have the same length and match element by element. Numbers match within 1e-9.
- **Special values** inside an expectation:
  - `{ "$absent": true }`: the key must not be present
  - `{ "$type": "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" }`: any value of that type
  - `{ "$any": true }`: any value
- **`body_excludes`**: none of these strings may appear anywhere in the serialized response.
- **`provider_calls`**: a number is the exact count of calls made during the step. An array is subset-matched against the calls in order, and also fixes the count.
- **`log`**: the rows the decider logged during the step, subset-matched in order. Rows expose `entry`, `set`, `set_hash`, `status`, `reason`, `request_id`, and, when the entry's `log` setting keeps them, `answers` and `state`.

HTTP status codes are not checked. The envelope is the source of truth.

## Reference harness

[`core/test/conformance.test.mjs`](../core/test/conformance.test.mjs) runs the suite against the TypeScript core with in-memory ports. The core also exports `runConformanceCase`, `createMockProvider`, and `matchExpected`, so a decider built on it only has to supply a `ConformanceHarness`: a function that builds a fresh decider with its own ports, plus a way to load entry files.

The installed `julius-core` package includes `conformance/cases/` and `conformance/entries/`, so a decider's own tests can run the suite straight from its dependencies (resolve `julius-core/package.json` and read the folder next to it).

## Notes for suite maintainers

- The fixtures are the source of truth; edit them directly.
- Expected `set_hash` values are computed with the section 8 algorithm. `check_fixtures.py` recomputes them and fails when one doesn't match.
- A good new case fails at least one plausible wrong implementation. Before adding one, check that it would catch the mistake it's meant to catch.
