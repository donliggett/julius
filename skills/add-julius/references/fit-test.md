# Fit test: which decisions belong in Julius

Julius is for decisions that need judgment, where the project will act on a typed answer and can cope when there's no answer. Most "if" statements are not that. Rejecting a candidate is a good result: a question that belongs in code or an LLM prompt makes the project slower, costlier, and less predictable.

## The tests

Apply them in order. The first test a candidate fails decides where it goes.

| # | Test | If it fails |
| --- | --- | --- |
| 1 | **Needs judgment.** Two careful people could disagree, or the rule has piled up exceptions. | Deterministic: write it in code. |
| 2 | **The answer is a label, not prose.** A yes/no, one of a fixed set of options, or a point on a rubric. | Needs written output: use an LLM call. |
| 3 | **Someone acts on it.** A branch, a route, a hold, a flag. There's a threshold or band that changes what happens. | Nobody acts on it: drop it. |
| 4 | **There's a fallback.** The project can say what happens when the decider is unavailable, over budget, or rate limited. | Not ready: settle the fallback first, or keep the current logic. |
| 5 | **State is small and local.** What's needed to judge fits in a short state built from data the project already holds. | Needs retrieval, long histories, or whole documents: rethink the question or the state. |
| 6 | **Timing and volume fit.** A decider round trip fits the latency budget, and the call volume fits a daily budget. | Too slow or too frequent: cache, batch, sample, or keep it in code. |

Counting, arithmetic, dates, distances, and lookups are never questions. Compute them in code and pass the result in state.

## Strong signals

- A keyword list or regex that keeps growing exceptions.
- An LLM call whose reply is parsed into `yes`/`no`, a category, or a number.
- Hand-tuned scoring with magic weights that nobody trusts.
- A human review queue where most items turn out to be routine.
- A comment like "TODO: figure out if this is…".

## Examples

| Candidate | Verdict | Why |
| --- | --- | --- |
| Is the uploaded file a PDF? | Code | Check the file signature. |
| How many items in the cart cost over $50? | Code | Arithmetic. |
| Has the user been inactive for 30 days? | Code | Date comparison. |
| Summarize this ticket for the support agent | LLM | Needs prose. |
| Write the reply to the customer | LLM | Needs prose. |
| Is this email asking for a refund? | Julius `yesno` | Judgment, label output, routes the email. |
| Which of five queues should get this ticket? | Julius `choice` | Judgment across fixed options. |
| How urgent is this report? | Julius `score` | Ordered rubric; drives response time. |
| Is this shell command destructive? | Julius `yesno` | Judgment; gates an agent action. Fail closed. |
| Is this comment harassment? | Julius `yesno` | Judgment; hides or flags. Needs a clear fallback. |
| Which of the user's recent orders is this about? | Julius `yesno` with `each` | One question per order; a small list of subjects. |
| Rank 500 search results | Not Julius | Too many subjects per call; use a ranking model. |
| Is this the user's real name? | Not Julius | Unanswerable from the state; the model can only guess. |
| Should we ban this account? | Julius can inform, not decide | Ask about observable facts ("the messages contain threats"); the project and a person make the call. |

## Telling the user

For each rejected candidate, say where it should go instead and why, in one line. If nothing passes, say that plainly and stop. An empty result is a correct answer.
