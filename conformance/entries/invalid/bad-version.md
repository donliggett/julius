# Conformance entry: bad-version

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "9.9"
entry: bad-version
access: private
model: mock-model-1
log: answers
budget:
  daily_usd: 10
sets:
  check:
    flag:
      type: yesno
      instructions: "The message asks for a refund"
```
