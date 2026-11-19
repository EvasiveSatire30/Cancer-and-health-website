import unittest

from cancer_screening import build_screening_result
from app import app


def valid_payload():
    return {
        "symptoms": [],
        "urgent_now": False,
        "age": None,
        "sex": None,
        "smoking": None,
        "alcohol": None,
        "family_history": None,
        "previous_diagnosis": None,
    }


class CancerScreeningGuidanceTests(unittest.TestCase):
    def test_symptoms_recommend_clinician_assessment_without_risk_score(self):
        payload = valid_payload()
        payload["symptoms"] = ["lump_or_swelling", "unusual_bleeding"]

        result = build_screening_result(payload)

        self.assertEqual(result["action"], "clinician_assessment")
        self.assertEqual(
            result["selected_symptoms"],
            ["A new or persistent lump or swelling", "Unusual bleeding or bruising"],
        )
        self.assertIn("disclaimer", result)
        self.assertNotIn("risk_level", result)
        self.assertNotIn("cancer_types", result)

    def test_urgent_self_report_overrides_other_guidance(self):
        payload = valid_payload()
        payload["symptoms"] = ["persistent_cough"]
        payload["urgent_now"] = True

        result = build_screening_result(payload)

        self.assertEqual(result["action"], "urgent_care")
        self.assertIn("urgent", result["next_step"].lower())

    def test_no_selected_symptoms_does_not_rule_out_cancer(self):
        result = build_screening_result(valid_payload())

        self.assertEqual(result["action"], "screening_discussion")
        self.assertIn("does not rule out cancer", result["next_step"].lower())

    def test_risk_factors_are_validated_but_do_not_create_a_score(self):
        payload = valid_payload()
        payload.update({
            "age": 58,
            "sex": "female",
            "smoking": "former",
            "alcohol": "regular",
            "family_history": "yes",
            "previous_diagnosis": "no",
        })

        result = build_screening_result(payload)

        self.assertEqual(result["action"], "screening_discussion")
        self.assertNotIn("risk_level", result)

    def test_rejects_unknown_symptoms_and_invalid_urgent_answer(self):
        payload = valid_payload()
        payload["symptoms"] = ["made_up_symptom"]
        with self.assertRaises(ValueError):
            build_screening_result(payload)

        payload = valid_payload()
        payload["urgent_now"] = "no"
        with self.assertRaises(ValueError):
            build_screening_result(payload)


class CancerScreeningRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_form_renders_privacy_and_guideline_context_without_caching(self):
        response = self.client.get("/screening")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("Your answers are processed", html)
        self.assertIn("not a Zimbabwe-specific screening schedule", html)
        self.assertIn("Find nearby medical facilities", html)
        self.assertIn("Parirenyatwa Hospital", html)
        self.assertIn("Fictional placeholder only", html)
        self.assertIn("Cancer types: general information", html)
        self.assertIn("not based on your answers", html)
        self.assertIn("Colorectal cancer (colon and rectum)", html)
        self.assertIn('id="workflowStatus"', html)
        self.assertIn('id="screeningStepSymptoms"', html)
        self.assertIn('id="screeningStepHistory"', html)
        self.assertIn('id="cancerInformationStep"', html)
        self.assertIn('id="facilityStep"', html)
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_screening_script_is_not_cached(self):
        response = self.client.get("/static/screening.js")

        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["Cache-Control"])
        response.close()

    def test_result_route_returns_disclaimer_and_prevents_caching(self):
        response = self.client.post("/screening/results", json=valid_payload())
        result = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertIn("disclaimer", result)
        self.assertNotIn("risk_level", result)
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)


if __name__ == "__main__":
    unittest.main()
