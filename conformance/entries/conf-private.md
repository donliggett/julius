# Conformance entry: conf-private

Test fixture for the Julius conformance suite. Not a real project.

```yaml julius
julius: "0.1"
entry: conf-private
access: private
model: mock-model-1
log: answers
budget:
  daily_usd: 10
shared:
  colors: { red: "Red things", green: "Green things", blue: "Blue things" }
sets:
  triage:
    kind:
      type: choice
      instructions: "What kind of report this is"
      options: [bug, feature, other]
    urgency:
      type: score
      instructions: "How soon someone needs to look at it"
      levels: ["This week", "Today", "Now"]
    risky:
      type: yesno
      instructions: "The report describes lost or corrupted data"
      if_true: "Data is gone, wrong, or unreadable"
  route:
    owns:
      type: yesno
      each: teams
      instructions: "Team {id} ({name}) owns the component in this report"
    tagged:
      type: yesno
      each: teams
      instructions: "Team {id} handles tickets tagged {{urgent}} and has {size} members"
    severe:
      type: yesno
      instructions: "The report describes an outage"
  shared-set:
    pick:
      type: choice
      instructions: "Which color the report is about"
      options: $colors
  nobands:
    flag:
      type: yesno
      instructions: "The report mentions a deadline"
bands:
  triage:
    rules:
      - { band: stop, when: "risky.p > 0.7" }
      - { band: escalate, when: 'risky.p > 0.5 or kind.choice == "bug" and urgency.level >= 2' }
      - { band: review, when: "kind.confidence < 0.5" }
      - { band: unsure, when: "urgency.confidence != 1 and urgency.level == 0" }
    default: go
```
