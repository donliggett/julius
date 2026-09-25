# Julius entry: Larkspur Support Inbox

> Worked example. Larkspur Tea Co. is a fictional online tea shop; everything here is illustrative.

## Why this project asks

**`triage`**: When a customer email arrives, the inbox decides who handles it and how fast. Keyword rules misroute anything phrased unusually, and a free-text LLM reply can't be thresholded or measured. Typed answers with probabilities let the inbox act on clear cases and send unclear ones to a person.

**`order-match`**: Before drafting a reply, the inbox links the email to one of the customer's recent orders. The number of orders varies per customer, so the question expands with `each`.

## State rules

| Set | Include | Never include | Size target |
| --- | --- | --- | --- |
| `triage` | Subject; the newest message body with quoted replies and signatures stripped; computed facts `open_orders` and `days_since_last_order` | Payment details, postal addresses, phone numbers, earlier messages in the thread, staff notes | Under 1,500 tokens |
| `order-match` | Subject and newest message body (as above). Order details go in `params.orders`, not state | Same as `triage` | Under 1,500 tokens; at most 5 orders |

Computed facts (counts, distances, dates, arithmetic) are calculated in code and passed as plain values. Decision models judge; they don't tally.

## When Julius can't answer

| Set | `unavailable` | `over_budget` | `rate_limited` | `rejected` |
| --- | --- | --- | --- | --- |
| `triage` | Fail open: put the email in the human queue, unsorted | Same as `unavailable`; alert the owner once per day | Retry once after `retry_after`, then treat as `unavailable` | Log and alert; treat as a bug. |
| `order-match` | Skip the match; the draft asks the customer for their order number | Same as `unavailable` | Same as `unavailable` | Log and alert; treat as a bug. |

## Acting on answers

| Set | Band / condition | Project action |
| --- | --- | --- |
| `triage` | `human_now` | Page the on-duty person; no automatic reply |
| `triage` | `human_queue` | Put in the shared queue, tagged with `topic.choice` |
| `triage` | `auto_draft` | Draft a reply for a person to approve; never send it automatically |
| `order-match` | Exactly one `is_about.<id>` with `p > 0.8` | Attach that order to the draft |
| `order-match` | Anything else | Attach nothing; the draft asks for the order number |

`topic.confidence` is only present when the provider supplies it. If it's missing, the `topic.confidence < 0.5` rule is false and that check is skipped.

## Entry

```yaml julius
julius: "0.1"
entry: larkspur-support
access: private
model: jev-1.13
accept_uncalibrated: false
log: answers
retention_days: 30
budget:
  daily_usd: 1.00

shared: {}

sets:
  triage:
    topic:
      type: choice
      instructions: "What the customer is writing about"
      options:
        order_status: "Where an order is, or when it will arrive"
        refund: "Money back, a replacement, or a damaged or wrong item"
        product_question: "Taste, brewing, ingredients, or caffeine"
        wholesale: "Buying for a cafe, shop, or event"
        other: "Anything else"
    urgency:
      type: score
      instructions: "How soon a person needs to answer"
      levels: ["Can wait a few days", "Answer today", "Answer within the hour"]
    refund_request:
      type: yesno
      instructions: "The customer is asking for money back or a replacement"
      if_true: "Asks for a refund, a replacement, or a credit"
      if_false: "Complains or asks a question without asking for anything back"
    hostile:
      type: yesno
      instructions: "The message contains threats, harassment, or abuse aimed at staff"

  order-match:
    is_about:
      type: yesno
      each: orders
      instructions: "The message is about order {id}, placed {placed_on}, containing {items}"

bands:
  triage:
    rules:
      - { band: human_now, when: "hostile.p > 0.5 or urgency.level >= 2" }
      - { band: human_queue, when: "refund_request.p > 0.6 or topic.confidence < 0.5" }
      - { band: auto_draft, when: 'topic.choice == "order_status" or topic.choice == "product_question"' }
    default: human_queue

examples: julius.examples.yaml
```

## Change log

| Date | Change | New `set_hash` |
| --- | --- | --- |
| 2026-01-15 | Initial entry | `triage` `1d741c4f`, `order-match` `daf5fc7e` |
