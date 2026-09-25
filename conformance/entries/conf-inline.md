# Conformance entry: conf-inline

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-inline
access: private
model: mock-model-1
log: answers
budget:
  daily_usd: 10
sets:
  triage:
    kind:
      type: choice
      instructions: "What kind of report this is"
      options: [bug, feature, other]
    urgency:
      type: score
      instructions: "How soon someone needs to look at it"
      levels: ["This week", "Today", "Now"]
    risky:
      type: yesno
      instructions: "The report describes lost or corrupted data"
      if_true: "Data is gone, wrong, or unreadable"
  shared-set:
    pick:
      type: choice
      instructions: "Which color the report is about"
      options: { red: "Red things", green: "Green things", blue: "Blue things" }
bands:
  triage:
    rules:
      - { band: stop, when: "risky.p > 0.9" }
    default: go
```
