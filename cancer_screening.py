import json
from pathlib import Path


RULES_PATH = Path(__file__).resolve().parent / "cancer_screening_rules.json"

with RULES_PATH.open(encoding="utf-8") as rules_file:
    SCREENING_RULES = json.load(rules_file)


def _validate_choice(value, choices, field):
    if value is None or value == "":
        return
    allowed = {option["value"] for option in choices}
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"Invalid value for {field}.")


def build_screening_result(payload):
    if not isinstance(payload, dict):
        raise ValueError("A JSON object is required.")

    symptoms = payload.get("symptoms", [])
    symptom_labels = {
        symptom["id"]: symptom["label"]
        for symptom in SCREENING_RULES["symptoms"]
    }
    if (
        not isinstance(symptoms, list)
        or any(not isinstance(item, str) or item not in symptom_labels for item in symptoms)
    ):
        raise ValueError("Select symptoms from the provided list.")

    urgent_now = payload.get("urgent_now")
    if not isinstance(urgent_now, bool):
        raise ValueError("Answer the urgent-symptom question.")

    age = payload.get("age")
    if age is not None and (
        isinstance(age, bool) or not isinstance(age, int) or age < 0 or age > 120
    ):
        raise ValueError("Age must be a whole number from 0 to 120.")

    risk_factors = SCREENING_RULES["risk_factors"]
    for field, definition in risk_factors.items():
        _validate_choice(payload.get(field), definition["options"], field)

    messages = SCREENING_RULES["messages"]
    if urgent_now:
        action = "urgent_care"
        next_step = messages["urgent"]
    elif symptoms:
        action = "clinician_assessment"
        next_step = messages["symptoms"]
    else:
        action = "screening_discussion"
        next_step = messages["no_symptoms"]

    return {
        "action": action,
        "selected_symptoms": [symptom_labels[item] for item in symptoms],
        "next_step": next_step,
        "discussion_prompt": messages["discussion"],
        "disclaimer": messages["disclaimer"],
        "privacy_notice": messages["privacy"],
        "sources": SCREENING_RULES["sources"],
    }
