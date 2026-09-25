# Conformance entry: conf-public

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-public
access: public
origins: ["https://app.example"]
model: mock-model-1
log: answers
budget:
  daily_usd: 10
  per_ip_per_min: 2
sets:
  check:
    flag:
      type: yesno
      instructions: "The message asks for a refund"
```
