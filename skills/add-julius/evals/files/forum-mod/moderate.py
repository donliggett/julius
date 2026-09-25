import re

BLOCKLIST = ["idiot", "moron", "kill yourself", "trash human"]
# Words that trip the blocklist but are fine in context. Keeps growing.
ALLOW_CONTEXT = ["kill the process", "idiot-proof", "trash can", "moron (the film)"]

CATEGORY_PATTERNS = {
    "help": re.compile(r"\b(how do i|error|doesn't work|broken|help)\b", re.I),
    "showcase": re.compile(r"\b(i made|i built|check out|finished)\b", re.I),
    "marketplace": re.compile(r"\b(for sale|selling|wts|wtb|price)\b", re.I),
}

MAX_LINKS = 3
MAX_LENGTH = 10_000


def is_abusive(text):
    lowered = text.lower()
    if any(ok in lowered for ok in ALLOW_CONTEXT):
        return False
    return any(bad in lowered for bad in BLOCKLIST)


def category(text):
    for name, pattern in CATEGORY_PATTERNS.items():
        if pattern.search(text):
            return name
    return "general"


def too_many_links(text):
    return len(re.findall(r"https?://", text)) > MAX_LINKS


def too_long(text):
    return len(text) > MAX_LENGTH


def summary_for_mods(text, llm):
    # Short summary shown to moderators in the review queue.
    return llm(f"Summarize this forum post in one sentence for a moderator:\n\n{text}")


def moderate(post, llm):
    text = post["body"]
    if too_long(text) or too_many_links(text):
        return {"action": "reject", "reason": "limits"}
    if is_abusive(text):
        return {"action": "hold", "summary": summary_for_mods(text, llm)}
    return {"action": "publish", "category": category(text)}
