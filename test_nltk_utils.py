import unittest

from nltk_utils import bag_of_words, stem, tokenize


class NlpPreprocessingTests(unittest.TestCase):
    def test_normalizes_breathing_paraphrases_to_existing_features(self):
        vocabulary = [stem(word) for word in tokenize("shortness of breath")]

        paraphrase = bag_of_words(tokenize("I'm having trouble breathing"), vocabulary)
        canonical = bag_of_words(tokenize("shortness of breath"), vocabulary)

        self.assertEqual(paraphrase.tolist(), canonical.tolist())

    def test_normalizes_common_symptom_synonyms(self):
        vocabulary = [stem(word) for word in tokenize("fever vomiting abdominal pain")]

        paraphrase = bag_of_words(
            tokenize("high temperature, throwing up, tummy ache"), vocabulary
        )
        canonical = bag_of_words(
            tokenize("fever, vomiting, abdominal pain"), vocabulary
        )

        self.assertEqual(paraphrase.tolist(), canonical.tolist())

    def test_removes_filler_words_without_dropping_symptoms(self):
        vocabulary = [stem(word) for word in tokenize("cough fever")]

        casual = bag_of_words(tokenize("I have a cough and fever"), vocabulary)
        concise = bag_of_words(tokenize("cough fever"), vocabulary)

        self.assertEqual(casual.tolist(), concise.tolist())

    def test_negated_symptom_is_excluded_but_contrast_symptom_is_kept(self):
        vocabulary = [stem(word) for word in ("fever", "cough")]

        features = bag_of_words(
            tokenize("I don't have a fever, but I have a cough"), vocabulary
        )

        self.assertEqual(features.tolist(), [0.0, 1.0])

    def test_no_sleep_is_kept_as_a_symptom_phrase(self):
        vocabulary = [stem(word) for word in ("no", "sleep")]

        features = bag_of_words(tokenize("no sleep"), vocabulary)

        self.assertEqual(features.tolist(), [1.0, 1.0])

    def test_not_only_does_not_negate_the_symptom(self):
        vocabulary = [stem("fever")]

        features = bag_of_words(tokenize("not only fever"), vocabulary)

        self.assertEqual(features.tolist(), [1.0])


if __name__ == "__main__":
    unittest.main()
