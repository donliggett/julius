# Conformance entry: conf-logfull

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-logfull
access: private
model: mock-model-1
log: full
budget:
  daily_usd: 10
sets:
  check:
    flag:
      type: yesno
      instructions: "The message asks for a refund"
```
