# Conformance entry: big-set

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: big-set
access: private
model: mock-model-1
log: answers
budget:
  daily_usd: 10
sets:
  check:
    a: { type: yesno, instructions: "Statement A holds" }
    b: { type: yesno, instructions: "Statement B holds" }
    c: { type: yesno, instructions: "Statement C holds" }
```
