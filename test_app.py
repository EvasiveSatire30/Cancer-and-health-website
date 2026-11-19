import unittest
from unittest.mock import patch

from app import app


class HomePageTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_homepage_exposes_regular_and_cancer_checkers(self):
        response = self.client.get("/")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn('href="/screening"', html)
        self.assertIn('id="regular-symptoms"', html)
        self.assertIn("Regular symptom checker", html)
        self.assertIn('aria-controls="chatPanel"', html)


class PredictEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_rejects_missing_or_malformed_json(self):
        missing = self.client.post("/predict", data="message")
        malformed = self.client.post(
            "/predict", data="{", content_type="application/json"
        )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(malformed.status_code, 400)
        self.assertIn("error", missing.get_json())
        self.assertIn("error", malformed.get_json())

    def test_rejects_missing_empty_and_non_string_messages(self):
        for payload in ({}, {"message": "  "}, {"message": 42}, {"message": None}):
            with self.subTest(payload=payload):
                response = self.client.post("/predict", json=payload)

                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.get_json())

    @patch("app.get_response", return_value=["greeting", "Hello"])
    def test_trims_message_and_returns_chat_response(self, get_response):
        response = self.client.post("/predict", json={"message": "  fever  "})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"answer": ["greeting", "Hello"]})
        get_response.assert_called_once_with("fever")


if __name__ == "__main__":
    unittest.main()
