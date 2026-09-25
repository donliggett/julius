# Conformance entry: missing-shared

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: missing-shared
access: private
model: mock-model-1
log: answers
budget:
  daily_usd: 10
sets:
  check:
    pick:
      type: choice
      instructions: "Which color"
      options: $colors
```
