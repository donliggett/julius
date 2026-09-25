# Conformance entry: conf-model2

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-model2
access: private
model: mock-model-2
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
```
