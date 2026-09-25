# Conformance entry: bool-key

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: bool-key
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
      true: "Asks for money back"
```
