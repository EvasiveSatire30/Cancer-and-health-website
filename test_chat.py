import unittest

from chat import get_response, rank_conditions
from nltk_utils import tokenize


class MultipleSymptomMatchingTests(unittest.TestCase):
    def test_multiple_symptoms_return_ranked_possible_matches(self):
        candidates = rank_conditions(
            tokenize("shortness of breath, wheezing, cough, chest tightness")
        )

        self.assertGreaterEqual(len(candidates), 2)
        self.assertLessEqual(len(candidates), 3)
        self.assertTrue(any(tag == "Asthma" for tag, _ in candidates))
        self.assertTrue(all(len(symptoms) >= 2 for _, symptoms in candidates))

    def test_negated_symptom_is_not_reported_as_matching_evidence(self):
        candidates = rank_conditions(
            tokenize("no cough, but wheezing and shortness of breath")
        )

        asthma = next(
            (symptoms for tag, symptoms in candidates if tag == "Asthma"), []
        )
        self.assertIn("wheezing", asthma)
        self.assertNotIn("cough", asthma)

    def test_chat_response_uses_multi_condition_payload(self):
        response = get_response(
            "shortness of breath, wheezing, cough, chest tightness"
        )

        self.assertEqual(response[0], "conditions")
        self.assertTrue(response[1])


if __name__ == "__main__":
    unittest.main()
