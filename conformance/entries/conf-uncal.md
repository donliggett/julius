# Conformance entry: conf-uncal

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-uncal
access: private
model: mock-model-1
accept_uncalibrated: true
log: answers
budget:
  daily_usd: 10
sets:
  check:
    flag:
      type: yesno
      instructions: "The message asks for a refund"
```
