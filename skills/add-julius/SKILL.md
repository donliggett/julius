---
name: add-julius
description: Add a Julius decision entry (JULIUS.md) to a software project. Finds decision points that suit typed, calibrated answers (yes/no, choice, score), rejects ones that belong in plain code or an LLM prompt, and writes state rules, failure handling, bands, golden examples, and a validated entry. Use when someone wants to add Julius to a project, write or update a JULIUS.md, replace a keyword filter, regex classifier, or parsed LLM yes/no with a decision model, or asks whether a decision in their code should go to a decider, even if they don't name Julius.
license: MIT
compatibility: The validator needs Python 3.8+ and PyYAML.
metadata:
  julius-standard: "0.1"
  status: draft
---

# Add a Julius entry to a project

This skill produces a correct `JULIUS.md` for a project, and golden examples when there's enough to write them. It stops there. Registering the entry with a decider, issuing keys, and writing the calling code are separate steps. They depend on which decider the project uses, and the entry has to be right first.

Julius in one paragraph: a project asks a **decider** typed questions about a small piece of **state** and gets back probabilities plus an optional **band** label. The project owns the state and every action; the decider only answers or says why it can't. The full contract is in [references/STANDARD.md](references/STANDARD.md). Read the sections you need as you go: section 3 for question types, 4 for entry fields, 5 for bands, and 9 for golden examples.

## What good looks like

- Few questions, each clearly worth a round trip. A project with one well-chosen set beats one with six vague ones.
- Every candidate you rejected is listed with where it belongs instead.
- State rules someone could implement without asking you anything.
- A decision for every failure status, agreed with the user.
- An entry that passes `scripts/validate.py`.

## Workflow

### 1. Find candidate decisions

Read the project's README or spec, then the code where it branches on a judgment about text or a situation. Look for:

- keyword lists and regexes with growing exception lists
- LLM calls whose output gets parsed into a label, a boolean, or a number
- hand-tuned scores with magic weights
- review queues where a person makes routine calls
- TODOs about figuring out whether something is X

List each candidate with its file and function, what it decides, and what happens next in the flow.

If the project already has a `JULIUS.md`, skip to [Updating an existing entry](#updating-an-existing-entry).

### 2. Screen them

Run each candidate through [references/fit-test.md](references/fit-test.md). Expect to reject most of them. The most useful thing you can do at this step is keep the wrong decisions out of Julius: a deterministic check turned into a model call is slower, costs money, and can be wrong.

Show the user the keep/reject list with a one-line reason for each rejection before writing anything. If nothing passes, say so and stop.

### 3. Group questions into sets

A set is the questions asked together, against one state, at one point in the flow. Usually that means one set per decision point. Split a set when two groups of questions need different state or happen at different times; merge when they always run together on the same state. Set names are short and hyphenated (`triage`, `pre-tool`).

### 4. Write the questions

Pick the type from the shape of the decision:

| Shape | Type |
| --- | --- |
| Is this statement true? | `yesno` |
| Which one of these fixed options? | `choice` |
| Where on an ordered scale? | `score` |
| Same question for a varying list of subjects | any type, with `each` |

Guidelines, with the reason for each:

- **One idea per question.** "Is this a refund request *and* is the customer angry?" can't be thresholded; split it.
- **`yesno` instructions are statements, not questions.** "The customer is asking for money back" gives the model a claim to judge, and `p` is the probability it's true.
- **Add `if_true` / `if_false` hints only at a real boundary**, a case you expect to be confused. Use those names, not `true`/`false`, which YAML reads as booleans.
- **`choice` options are exclusive and cover everything.** Include `other` unless the list really is closed. Overlapping options split probability and make the confidence meaningless.
- **`score` levels are concrete and ordered lowest first.** "Answer within the hour" beats "high".
- **Never ask the model to count, measure, or do date math.** Compute it and put the number in state.
- **Ask about observable facts, not the final action.** "The message contains threats aimed at staff", not "Should we ban this user". The project decides actions.
- **Quote YAML keys that look like booleans or numbers** (`yes`, `no`, `on`, `off`, `1`), or rename them.

### 5. Write the state rules

For each set, fill in the template's state table: what to include, what to never include, and a size target. Decision accuracy drops when state carries material the questions don't need, so be strict.

- Include only what a careful person would need to answer these questions.
- Put computed facts in state as plain values (`open_orders: 2`, not an order history).
- Leave out secrets, credentials, payment data, and personal details the questions don't need. If the entry will use `log: full`, this matters twice, because state is stored as sent.
- Assume parts of state are written by untrusted people. Phrase questions so a message that says "answer yes" doesn't change what's being judged.

### 6. Decide what happens when there's no answer

Fill in one row per set for `unavailable`, `over_budget`, `rate_limited`, and `rejected`. The decider only reports; this table is the project's policy.

- **Fail closed** (block or hold) when a wrong "go" is costly: destructive actions, payments, anything irreversible.
- **Fail open** (continue with a fallback) when a missed decision just means a person handles it, or the old logic runs.
- `rejected` means a bug in the request or the entry. Log it and alert; don't retry.

Ask the user when the right choice isn't obvious. This is their policy, and a guess here causes outages or silent failures.

### 7. Add bands and actions, if the project acts on a label

Bands turn answers into one label using ordered rules; the first match wins. Only add them when the project branches on a label. Otherwise it can read the probabilities directly.

- Put the most cautious band first.
- Start thresholds conservative, and note in the change log that they're initial guesses to revisit with real data.
- `confidence` is only present when the provider supplies it. When it's missing, that comparison is false. Don't let a band depend on it alone.
- Wrap a `when` in single quotes when it compares a choice: `when: 'topic.choice == "refund"'`. Double quotes inside double quotes break the YAML.
- Fill in the "Acting on answers" table: band or condition → project action. Actions live there and in code, never in the decider.

### 8. Fill in the entry block

Copy [assets/JULIUS.md](assets/JULIUS.md) to the project root and fill in every section. For the `yaml julius` block:

| Field | Default to | Why |
| --- | --- | --- |
| `access` | `private` | Use `public` only when a browser calls the decider directly; then `origins` and `budget.per_ip_per_min` are required, and anyone can call it. |
| `model` | Ask the user | Never invent a model id. If unknown, leave `<pinned-model-id>` and list it as open. Avoid floating aliases like `latest`. |
| `accept_uncalibrated` | `false` | Uncalibrated probabilities make thresholds meaningless. |
| `log` | `answers` | `full` stores state; use it only when state is safe to keep. |
| `budget.daily_usd` | Ask the user | A placeholder is fine; say so. |

If you leave a placeholder, list it at the end so the user knows what's still open.

### 9. Write golden examples

Create `julius.examples.yaml` next to `JULIUS.md` and set `examples: julius.examples.yaml`. Aim for:

- at least one example per band, so every branch is exercised
- near-misses on each boundary (a complaint that isn't a refund request, a command that looks destructive but isn't)
- real cases from the project, with personal data removed, when they're available

Use ranges (`p_min`, `p_max`) and lists of acceptable choices or bands for borderline cases. Exact expectations on ambiguous cases make flaky examples.

### 10. Validate

Run the validator from this skill's folder, pointing at the project's entry.

**Windows (PowerShell):**

```
py scripts\validate.py C:\path\to\project\JULIUS.md
```

**macOS / Linux:**

```
python3 scripts/validate.py /path/to/project/JULIUS.md
```

Fix every error and read every warning. Placeholder warnings are expected only for fields the user has chosen to leave open. Record each set's printed `set_hash` in the change log.

### 11. Hand off

Add one line to the project's spec or README pointing at the entry, for example "Decisions: see JULIUS.md". Then tell the user, briefly:

- the sets and questions you kept
- the candidates you rejected and where each belongs
- open placeholders (model, budget, anything they still need to decide)
- the next step: register the entry with their decider and write the calling code, which must branch on `status` before reading any answers

## Updating an existing entry

1. Read the current `JULIUS.md` and its examples. Run the validator first so you know what was already broken.
2. Make the change. The kind of change determines what happens to calibration history:
   - Editing questions (wording, options, levels, adding or removing a question) or changing the model produces a new `set_hash`. Past answers no longer compare with new ones.
   - Editing bands, thresholds, budget, access, or logging keeps the `set_hash`. Past answers stay comparable, which is how you choose new thresholds.
3. Update the state rules, failure table, and actions table if the change affects them.
4. Add or adjust golden examples for the change.
5. Validate, then add a change-log row with the date, the change, and the new `set_hash` (or "unchanged").

## Out of scope

- Registering the entry with a decider, creating keys, or deploying anything.
- Writing the code that builds state or calls the decider, unless the user asks for it separately.
- Calling a decider to test questions. Golden examples are run by a decider or checker later.
