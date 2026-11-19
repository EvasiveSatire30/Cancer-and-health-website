import numpy as np
import re
from nltk.stem.porter import PorterStemmer

stemmer = PorterStemmer()
PUNCTUATION = {",", ";", ".", "!", "?"}
NEGATIONS = {"no", "not", "never", "without", "deny", "denies", "denied"}
NEGATION_ENDERS = {"but", "however", "although", "except"}
POSITIVE_NO_PHRASES = {("no", "sleep"), ("no", "appetite")}
STOP_WORDS = {
    "a", "an", "am", "and", "are", "as", "at", "be", "been", "being", "by", "can",
    "could", "did", "do", "does", "for", "from", "had", "has", "have",
    "he", "her", "hers", "him", "his", "i", "in", "into", "is", "it",
    "its", "me", "my", "of", "on", "our", "ours", "please", "she", "that",
    "the", "their", "them", "they", "this", "those", "to", "us", "was",
    "we", "were", "with", "you", "your", "yours", "experiencing",
    "experience", "experiences", "feel", "feeling", "felt", "having", "or",
}

ALIASES = (
    ("can't catch my breath", "shortness of breath"),
    ("cannot catch my breath", "shortness of breath"),
    ("short of breath", "shortness of breath"),
    ("difficulty breathing", "shortness of breath"),
    ("trouble breathing", "shortness of breath"),
    ("hard to breathe", "shortness of breath"),
    ("can't breathe", "shortness of breath"),
    ("cannot breathe", "shortness of breath"),
    ("breathlessness", "shortness of breath"),
    ("chest feels tight", "chest tightness"),
    ("chest is tight", "chest tightness"),
    ("racing heart", "rapid heart rate"),
    ("high temperature", "fever"),
    ("stomach ache", "abdominal pain"),
    ("tummy ache", "abdominal pain"),
    ("throwing up", "vomiting"),
    ("can't sleep", "no sleep"),
    ("cannot sleep", "no sleep"),
    ("unable to sleep", "no sleep"),
)

CONTRACTIONS = {
    "aren't": "are not",
    "can't": "can not",
    "couldn't": "could not",
    "didn't": "did not",
    "doesn't": "does not",
    "don't": "do not",
    "hadn't": "had not",
    "hasn't": "has not",
    "haven't": "have not",
    "i'd": "i would",
    "i'll": "i will",
    "i'm": "i am",
    "i've": "i have",
    "isn't": "is not",
    "mustn't": "must not",
    "shouldn't": "should not",
    "wasn't": "was not",
    "weren't": "were not",
    "we're": "we are",
    "we've": "we have",
    "won't": "will not",
    "you're": "you are",
    "you've": "you have",
    "wouldn't": "would not",
}


def _replace_phrase(text, phrase, replacement):
    pattern = r"(?<!\w)" + re.escape(phrase) + r"(?!\w)"
    return re.sub(pattern, replacement, text, flags=re.IGNORECASE)


def tokenize(sentence):
    sentence = sentence.lower().replace("’", "'")
    for phrase, replacement in ALIASES:
        sentence = _replace_phrase(sentence, phrase, replacement)
    for contraction, expansion in CONTRACTIONS.items():
        sentence = _replace_phrase(sentence, contraction, expansion)
    tokens = re.findall(r"[a-z0-9]+|[,;.!?]", sentence)
    return [
        token for token in tokens
        if token not in STOP_WORDS or token in PUNCTUATION or token in NEGATIONS
    ]


def stem(word):
    return stemmer.stem(word.lower())


def positive_tokens(tokenized_sentence):
    sentence_words = []
    negated = False

    for index, word in enumerate(tokenized_sentence):
        if word in NEGATION_ENDERS:
            negated = False
            continue
        if word in PUNCTUATION:
            if word != ",":
                negated = False
            continue

        if word in NEGATIONS:
            if (
                word == "not"
                and index + 1 < len(tokenized_sentence)
                and tokenized_sentence[index + 1] == "only"
            ):
                continue
            positive_no_phrase = (
                word == "no"
                and index + 1 < len(tokenized_sentence)
                and (word, tokenized_sentence[index + 1]) in POSITIVE_NO_PHRASES
            )
            if positive_no_phrase:
                sentence_words.append(stem(word))
            else:
                negated = True
            continue

        if not negated:
            sentence_words.append(word)

    return sentence_words


def bag_of_words(tokenized_sentence, words):
    sentence_words = [stem(word) for word in positive_tokens(tokenized_sentence)]

    bag = np.zeros(len(words), dtype=np.float32)
    for idx, w in enumerate(words):
        if w in sentence_words:
            bag[idx] = 1

    return bag
