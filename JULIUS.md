<!--
  Julius entry template (Julius Standard v0.1)

  Copy this file into your project root as JULIUS.md and fill in every section.
  Point your project spec at it ("Decisions: see JULIUS.md").
  The fenced block tagged `yaml julius` is read by the decider at registration;
  everything else is for people and coding agents working on the project.
  Delete these comments once filled in.
-->

# Julius entry: <Project name>

## Why this project asks

<!-- One short paragraph per set: what decision is being made, where in the
     project's flow it happens, and why a typed answer beats code rules or an LLM call. -->

**`<set-name>`** — …

## State rules

<!-- The state builder is the most important code this entry depends on.
     Accuracy drops when state carries material the questions don't need. -->

| Set | Include | Never include | Size target |
| --- | --- | --- | --- |
| `<set-name>` | … | … | e.g. under 2,000 tokens |

Computed facts (counts, distances, dates, arithmetic) are calculated in code and passed as plain values. Decision models judge; they don't tally.

## When Julius can't answer

<!-- The decider reports status; this project decides what follows.
     Fill in one row per set. "Fail closed" = block/hold. "Fail open" = continue with a fallback. -->

| Set | `unavailable` | `over_budget` | `rate_limited` | `rejected` |
| --- | --- | --- | --- | --- |
| `<set-name>` | … | … | … | Log and alert; treat as a bug. |

## Acting on answers

<!-- Which bands or thresholds this project acts on, and what each one triggers.
     Bands are labels from the decider; the actions live here and in code. -->

| Set | Band / condition | Project action |
| --- | --- | --- |
| `<set-name>` | … | … |

## Entry

```yaml julius
julius: "0.1"
entry: <project-slug>
access: private            # private | public
# origins: ["https://app.example.com"]   # required when access: public
model: <pinned-model-id>
accept_uncalibrated: false
log: answers               # full | answers | none
retention_days: 30
budget:
  daily_usd: 0.50
  # per_ip_per_min: 30     # required when access: public

shared: {}

sets:
  <set-name>:
    <question_id>:
      type: yesno
      instructions: "<statement to judge true or false>"

bands: {}

# examples: julius.examples.yaml
```

## Change log

| Date | Change | New `set_hash` |
| --- | --- | --- |
| | Initial entry | |
