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
        self.assertIn('href="/articles"', html)
        self.assertIn('id="regular-symptoms"', html)
        self.assertIn("Regular symptom checker", html)
        self.assertIn('aria-controls="chatPanel"', html)


class ArticlePageTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_article_index_has_search_and_requested_categories(self):
        response = self.client.get("/articles")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn('name="q"', html)
        self.assertIn('name="category"', html)
        for category in (
            "Prevention and Lifestyle",
            "Foods and Nutrition",
            "Warning Signs",
            "Screening and Check-ups",
            "Survivor Stories",
        ):
            with self.subTest(category=category):
                self.assertIn(category, html)

    def test_search_and_category_filters_narrow_the_article_list(self):
        category_response = self.client.get(
            "/articles?category=Foods+and+Nutrition"
        )
        category_html = category_response.get_data(as_text=True)
        self.assertEqual(category_response.status_code, 200)
        self.assertIn("Food and cancer: what the evidence can and cannot tell us", category_html)
        self.assertNotIn("Warning signs: when a change deserves attention", category_html)

        search_response = self.client.get("/articles?q=unexplained+weight+loss")
        search_html = search_response.get_data(as_text=True)
        self.assertEqual(search_response.status_code, 200)
        self.assertIn("Warning signs: when a change deserves attention", search_html)
        self.assertNotIn("Food and cancer: what the evidence can and cannot tell us", search_html)

    def test_article_page_has_disclaimer_sources_related_content_and_screening_cta(self):
        response = self.client.get("/articles/everyday-steps-to-lower-cancer-risk")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn('name="description"', html)
        self.assertIn("For education only — not medical advice.", html)
        self.assertIn(">Sources</h2>", html)
        self.assertIn("Related Articles", html)
        self.assertIn('href="/screening"', html)
        self.assertIn("Share article", html)

    def test_unconsented_survivor_placeholder_is_not_mislabeled_as_a_story(self):
        response = self.client.get("/articles/how-survivor-stories-are-shared")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("Sample placeholder — not a personal story", html)
        self.assertIn("Each person’s experience is unique", html)
        self.assertNotIn("Shared with permission", html)

    def test_unconsented_personal_story_is_not_published(self):
        private_story = {
            "slug": "unapproved-personal-story",
            "category": "Survivor Stories",
            "consent": False,
            "placeholder": False,
            "content": [],
        }
        with patch("app.ARTICLE_DATA", [private_story]):
            response = self.client.get(
                "/articles/unapproved-personal-story"
            )

        self.assertEqual(response.status_code, 404)

    def test_consented_survivor_story_gets_permission_label(self):
        consented_story = {
            "title": "A consented story",
            "slug": "consented-story",
            "category": "Survivor Stories",
            "summary": "A sample story used to test the consent label.",
            "author": "CareGuide Editorial Team",
            "date": "2026-11-19",
            "consent": True,
            "content": [{"heading": "Story", "paragraphs": ["Sample text."]}],
            "sources": [
                {
                    "organization": "World Health Organization",
                    "title": "Cancer",
                    "url": "https://www.who.int/news-room/fact-sheets/detail/cancer",
                }
            ],
        }
        with patch("app.ARTICLE_DATA", [consented_story]):
            response = self.client.get("/articles/consented-story")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Shared with permission", response.get_data(as_text=True))

    def test_unknown_article_slug_returns_not_found(self):
        response = self.client.get("/articles/not-an-article")
        self.assertEqual(response.status_code, 404)


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
