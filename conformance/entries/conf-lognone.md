# Conformance entry: conf-lognone

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-lognone
access: private
model: mock-model-1
log: none
budget:
  daily_usd: 10
sets:
  check:
    flag:
      type: yesno
      instructions: "The message asks for a refund"
```
