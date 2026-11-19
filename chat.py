import random
import json
import torch
import re

import math
import geocoder

from model_chat import RNNModel  # Import the RNN model
from nltk_utils import bag_of_words, positive_tokens, stem, tokenize

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

with open(BASE_DIR / 'intents.json', 'r', encoding='utf-8') as json_data:
    intents = json.load(json_data)

FILE = BASE_DIR / "data_rnn_nlp.pth"
data = torch.load(FILE, map_location=device)

input_size = data["input_size"]
hidden_size = data["hidden_size"]
output_size = data["output_size"]
num_layers = data["num_layers"]  # Add the number of layers used in your RNN model
all_words = data['all_words']
tags = data['tags']
model_state = data["model_state"]

model = RNNModel(input_size, hidden_size, output_size, num_layers).to(device)
model.load_state_dict(model_state)
model.eval()

bot_name = "Sam"
NON_MEDICAL_TAGS = {
    "greeting", "goodbye", "work", "who", "thanks", "joke",
    "name", "age", "gender",
}


def _contains_phrase(tokens, phrase):
    size = len(phrase)
    return any(tuple(tokens[index:index + size]) == phrase for index in range(len(tokens) - size + 1))


def _build_condition_patterns():
    conditions = {}
    symptom_labels = {}

    for intent in intents["intents"]:
        tag = intent["tag"]
        if tag.lower() in NON_MEDICAL_TAGS:
            continue

        condition = conditions.setdefault(tag, {"intent": intent, "patterns": []})
        for pattern in intent.get("patterns", []):
            symptom_terms = []
            for phrase in pattern.split(","):
                words = positive_tokens(tokenize(phrase))
                term = tuple(stem(word) for word in words)
                if term:
                    symptom_labels.setdefault(term, phrase.strip())
                    if term not in symptom_terms:
                        symptom_terms.append(term)
            if symptom_terms:
                condition["patterns"].append(tuple(symptom_terms))

    return conditions, symptom_labels


CONDITION_PATTERNS, SYMPTOM_LABELS = _build_condition_patterns()


def rank_conditions(tokenized_sentence, limit=3):
    query_tokens = [stem(word) for word in positive_tokens(tokenized_sentence)]
    matched_terms = {
        term for term in SYMPTOM_LABELS
        if _contains_phrase(query_tokens, term)
    }

    if len(matched_terms) < 2:
        return []

    matched_terms = {
        term for term in matched_terms
        if not any(
            len(other) > len(term) and _contains_phrase(other, term)
            for other in matched_terms
        )
    }

    ranked = []
    for tag, condition in CONDITION_PATTERNS.items():
        best_score = 0.0
        best_matches = set()
        for pattern in condition["patterns"]:
            matches = set(pattern).intersection(matched_terms)
            if len(matches) < 2:
                continue
            score = 2 * len(matches) / (len(pattern) + len(matched_terms))
            if score > best_score:
                best_score = score
                best_matches = matches

        if best_matches and best_score >= 0.25:
            labels = sorted(SYMPTOM_LABELS[term] for term in best_matches)
            ranked.append((best_score, tag, labels))

    ranked.sort(key=lambda result: (-result[0], result[1].lower()))
    return [[tag, matches] for _, tag, matches in ranked[:limit]]

def get_response(msg):
    if not isinstance(msg, str) or not msg.strip():
        return ["not_understand", "Please enter a message."]

    sentence = tokenize(msg)
    if ("yes" in sentence) or (("medical" in sentence) and "center" in sentence) or ("hospital" in sentence) or ("hospitals" in sentence) :
        li = centres()
        return li

    X = bag_of_words(sentence, all_words)
    if not X.any():
        return [
            "not_understand",
            "I couldn't identify any symptoms in that message. Please describe what you are experiencing.",
        ]
    X = torch.tensor(X).view(1, 1, -1).to(device)

    output = model(X)
    _, predicted = torch.max(output, dim=1)
    tag = tags[predicted.item()]
    probs = torch.softmax(output, dim=1)
    prob = probs[0][predicted.item()]

    if tag.lower() in {"name", "age", "gender"} and prob.item() > 0.75:
        return [
            "not_understand",
            "You do not need to share your name, age, or gender. Please describe your symptoms without personal details.",
        ]

    if tag.lower() in NON_MEDICAL_TAGS and prob.item() > 0.75:
        for intent in intents["intents"]:
            if intent["tag"] == tag:
                return [intent["tag"], intent["responses"]]

    candidates = rank_conditions(sentence)
    if candidates:
        return ["conditions", candidates]

    if prob.item() > 0.75:
        for intent in intents['intents']:
            if intent["tag"] == tag:
                return [intent['tag'], intent['responses'], intent['Precaution']]

    return ["not_understand","I do not understand. Can you please rephrase the sentence?"]

def centres():
    # Function to calculate the Haversine distance between two points
    def haversine(lat1, lon1, lat2, lon2):
        # Radius of the Earth in kilometers
        R = 6371.0

        # Convert latitude and longitude from degrees to radians
        lat1 = math.radians(lat1)
        lon1 = math.radians(lon1)
        lat2 = math.radians(lat2)
        lon2 = math.radians(lon2)

        # Haversine formula
        dlon = lon2 - lon1
        dlat = lat2 - lat1

        a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        # Calculate the distance
        distance = R * c
        return distance

    # Get your current location based on your IP address
    location = geocoder.ip('me')
    given_location = getattr(location, 'latlng', None)
    if not given_location or len(given_location) != 2:
        return ["center"]

    # Load the JSON data
    with open(BASE_DIR / "medical_centers.json", "r", encoding="utf-8") as json_file:
        medical_centers = json.load(json_file)

    # Calculate distances to all medical centers
    distances_to_centers = []

    for center in medical_centers["intents"]:
        center_location = center["location"]
        distance = haversine(given_location[0], given_location[1], center_location[0], center_location[1])
        distances_to_centers.append((center["tag"], distance))

    # Sort the list of distances in ascending order
    distances_to_centers.sort(key=lambda x: x[1])

    l = ["center"]


    for i, (center_name, distance) in enumerate(distances_to_centers[:5], start=1):
        for center in medical_centers["intents"]:
            if center["tag"] == center_name:
                l.append([center_name, (str(round(distance, 2))+'km'), center["Address"]])
    return l


if __name__ == "__main__":
    print("Let's chat! (type 'quit' to exit)")
    while True:
        sentence = input("You: ")
        if sentence == "quit":
            break

        resp = get_response(sentence)
        print("Bot:", resp)
