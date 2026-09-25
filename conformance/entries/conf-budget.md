# Conformance entry: conf-budget

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-budget
access: private
model: mock-model-1
log: answers
budget:
  daily_usd: 0.5
sets:
  check:
    flag:
      type: yesno
      instructions: "The message asks for a refund"
```
