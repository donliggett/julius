from datetime import date, timedelta

TAX_RATES = {"US-IA": 0.06, "US-MN": 0.06875, "none": 0.0}
TERMS_DAYS = {"net15": 15, "net30": 30}


def subtotal(lines):
    return sum(l["qty"] * l["unit_price"] for l in lines)


def tax(lines, region):
    return round(subtotal(lines) * TAX_RATES[region], 2)


def due_date(issued: date, terms: str) -> date:
    return issued + timedelta(days=TERMS_DAYS[terms])


def is_overdue(invoice, today: date) -> bool:
    return not invoice["paid"] and today > due_date(invoice["issued"], invoice["terms"])


def duplicate_number(invoice, existing_numbers) -> bool:
    return invoice["number"] in existing_numbers


def needs_reminder(invoice, today: date) -> bool:
    # Send a reminder 3 days before due, and weekly once overdue.
    d = due_date(invoice["issued"], invoice["terms"])
    if invoice["paid"]:
        return False
    if today == d - timedelta(days=3):
        return True
    return today > d and (today - d).days % 7 == 0
