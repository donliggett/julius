# Worked example: support inbox

A complete Julius entry for a fictional online tea shop, Larkspur Tea Co., whose support inbox uses a decider to route incoming email.

| File | What it shows |
| --- | --- |
| [`JULIUS.md`](JULIUS.md) | A filled-in entry: why each set exists, state rules, failure handling, what each band triggers, and the entry block itself |
| [`julius.examples.yaml`](julius.examples.yaml) | Golden examples covering each band and an `each` expansion |

The requests and responses below are what the inbox sends and gets back. The numbers are illustrative.

## Triage an email

The inbox builds state from the newest message, following the state rules in `JULIUS.md`, and computes `open_orders` and `days_since_last_order` itself.

```
POST /v1/decide
Authorization: Bearer <larkspur-support key>
Content-Type: application/json
```

```json
{
  "entry": "larkspur-support",
  "set": "triage",
  "state": {
    "subject": "Where is my order?",
    "body": "Hi, I ordered the jasmine green sampler last week and haven't seen a tracking number yet. Could you check?",
    "open_orders": 1,
    "days_since_last_order": 6
  },
  "request_id": "msg-20260115-0042"
}
```

```json
{
  "status": "ok",
  "julius": "0.1",
  "entry": "larkspur-support",
  "set": "triage",
  "set_hash": "877f67e9",
  "provider": "example-provider",
  "model": "example-model-1",
  "calibrated": true,
  "answers": {
    "topic": {
      "choice": "order_status",
      "probs": { "order_status": 0.91, "refund": 0.03, "product_question": 0.02, "wholesale": 0.01, "other": 0.03 },
      "confidence": 0.88
    },
    "urgency": { "score": 0.7, "level": 1, "label": "Answer today", "confidence": 0.71 },
    "refund_request": { "p": 0.06 },
    "hostile": { "p": 0.01 }
  },
  "band": "auto_draft",
  "ms": 184,
  "request_id": "msg-20260115-0042"
}
```

How the band was reached, rule by rule:

1. `human_now`: `hostile.p` is 0.01 and `urgency.level` is 1, so no match.
2. `human_queue`: `refund_request.p` is 0.06 and `topic.confidence` is 0.88, so no match.
3. `auto_draft`: `topic.choice` is `order_status`, so this rule matches.

The inbox drafts a reply for a person to approve, as its "Acting on answers" table says. The decider only returned the label.

## Match the email to an order

The customer has two recent orders, so the inbox sends them as `params.orders` and the decider asks `is_about` once for each.

```json
{
  "entry": "larkspur-support",
  "set": "order-match",
  "state": {
    "subject": "Question about my chai",
    "body": "The masala chai I just got tastes different from last time. Is it a new blend?"
  },
  "params": {
    "orders": [
      { "id": "a1042", "placed_on": "2026-01-02", "items": "Masala chai 100g" },
      { "id": "a0977", "placed_on": "2025-11-18", "items": "Jasmine green sampler, glass teapot" }
    ]
  }
}
```

```json
{
  "status": "ok",
  "julius": "0.1",
  "entry": "larkspur-support",
  "set": "order-match",
  "set_hash": "0b7d6020",
  "provider": "example-provider",
  "model": "example-model-1",
  "calibrated": true,
  "answers": {
    "is_about.a1042": { "p": 0.93 },
    "is_about.a0977": { "p": 0.04 }
  },
  "ms": 201
}
```

Exactly one order is above 0.8, so the inbox attaches order `a1042` to the draft.

## When the decider can't answer

```json
{
  "status": "unavailable",
  "julius": "0.1",
  "entry": "larkspur-support",
  "set": "triage",
  "reason": "provider_timeout",
  "retry_after": 30,
  "ms": 5003,
  "request_id": "msg-20260115-0043"
}
```

The entry says `triage` fails open, so the email goes into the human queue unsorted. The inbox doesn't retry, invent a band, or fall back to keyword rules unless its entry says to.
