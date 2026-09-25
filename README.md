# Julius

Julius is an open standard for asking a decision model typed questions about a piece of state and getting back calibrated, machine-readable answers.

A project describes its questions once, sends state when it needs a decision, and gets back probabilities and a band label it can act on in code. The service in the middle, called a **decider**, can use any provider or model that answers Julius question types.

> **Status:** draft, v0.1. Breaking changes are possible before 1.0.

## Why

Some decisions in software are too fuzzy for hand-written rules and too important for a free-text LLM reply. For example: is this command destructive, which team should get this email, or is this request urgent. Julius makes those decisions typed:

- **`choice`**: which of these options?
- **`score`**: where on this rubric?
- **`yesno`**: is this statement true?

Every answer comes with probabilities, so a project can set thresholds, send unclear cases to a person, and measure accuracy over time. Every response also says whether those probabilities come from a calibrated model.

## How it fits together

```
project ──state──▶ decider ──▶ provider / model
   ▲                  │
   └──── answers ─────┘
         + band
         + status
```

| Part | Owns |
| --- | --- |
| **Project** | What goes into state, and what to do with every answer, including when there is no answer |
| **Decider** | Auth, validation, calling the provider, applying bands, logging, budgets. Never builds state, never takes actions |
| **Provider** | The model that produces the answers |

When the decider can't answer (provider down, budget spent, rate limited, bad request), it returns a status and a reason. The project's entry doc says what happens next.

## A quick look

A project declares its questions in a fenced `yaml julius` block inside its `JULIUS.md`:

```yaml
julius: "0.1"
entry: ops-agent
access: private
model: <pinned-model-id>
log: answers
budget: { daily_usd: 0.50 }

sets:
  pre-tool:
    irreversible:
      type: yesno
      instructions: "The action destroys or overwrites data that cannot be recovered"

bands:
  pre-tool:
    rules:
      - { band: stop, when: "irreversible.p > 0.7" }
    default: proceed
```

It asks:

```json
{ "entry": "ops-agent", "set": "pre-tool", "state": { "action": "npm run db:reset" } }
```

And branches on the response:

```json
{
  "status": "ok",
  "set_hash": "…",
  "calibrated": true,
  "answers": { "irreversible": { "p": 0.82 } },
  "band": "stop"
}
```

## Using Julius in a project

1. Copy [`JULIUS.md`](JULIUS.md) into your project root and fill in every section: why each set exists, what goes into state, what to do when there's no answer, and what each band triggers.
2. Point your project spec at it, for example "Decisions: see JULIUS.md".
3. Register the entry with a decider. How registration works depends on the decider.
4. In code, build state following your state rules, call `/v1/decide`, and branch on `status` before anything else.
5. Optionally, add golden examples (`julius.examples.yaml`) so edits and model changes can be checked.

[`examples/support-inbox/`](examples/support-inbox/) is a complete worked example: a filled-in entry, golden examples, and sample requests and responses.

## Building a decider

[`STANDARD.md`](STANDARD.md) is the full specification: question types, entry schema, band grammar, request and response formats, reason codes, `set_hash`, and the conformance checklist in section 10.

## Repository layout

| Path | Contents |
| --- | --- |
| [`STANDARD.md`](STANDARD.md) | The Julius Standard |
| [`JULIUS.md`](JULIUS.md) | Entry template to copy into a project |
| [`examples/`](examples/) | Worked examples |

## License

[MIT](LICENSE)
