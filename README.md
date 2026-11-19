
# Symptom Checker Chatbot ai 

![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)

A simple chatbot that can help users check their symptoms and provide relevant information. This chatbot uses natural language processing (NLP) techniques and a recurrent neural network (RNN) model to understand user queries and respond accordingly.

## Table of Contents

- [Introduction](#introduction)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Training](#training)
- [Dependencies](#dependencies)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#Contact)

## Introduction

This repository contains code for a symptom checker chatbot. The chatbot can engage in conversations with users, gather information about their symptoms, and provide information about potential conditions or nearby medical centers. It uses a pre-trained RNN model for natural language understanding.

## Getting Started

To get started with the Symptom Checker Chatbot, follow these steps:

1. Clone the repository to your local machine:

   ```
   git clone https://github.com/your-username/symptom-checker-chatbot.git
   ```

2. Install the required dependencies:

   ```
   pip install -r requirements.txt
   ```

3. Download the necessary data files and place them in the appropriate directories:
   - `intents.json`: Contains predefined intents for the chatbot.
   - `data_rnn.pth`: Pre-trained RNN model for natural language understanding.
   - `medical_centers.json`: Data file containing information about medical centers.

## Usage

To use the Symptom Checker Chatbot, run the `app.py` file:

```
python app.py
```

This will start a Flask web application. Visit `http://localhost:5000` to choose between the regular symptom checker chat and the separate cancer symptom check.

Describe all the symptoms you are experiencing in one message. When multiple symptom phrases match the intent examples, the chatbot returns up to three possible matches and shows the matching symptoms. These are pattern matches for informational use, not a medical diagnosis.

## Training

If you want to retrain the RNN model or modify the chatbot's behavior, follow these steps:

1. Modify the intents and patterns in `intents.json` to customize the chatbot's responses.

2. Run the training script to retrain the RNN model:

   ```
   python train.py
   ```

3. The script saves the updated model as `data_rnn_nlp.pth`; `chat.py` loads this file. The original `data_rnn.pth` is left untouched. If you choose a different output filename, update the `FILE` variable in `chat.py` to match.

The training and inference code share the same tokenization, symptom normalization, and negation handling. Retrain the model after changing the NLP preprocessing or intent patterns.

## Dependencies

The Symptom Checker Chatbot relies on the following dependencies:

- Python 3.x
- PyTorch
- Flask
- NLTK
- geocoder

You can install these dependencies using the provided `requirements.txt` file.

## Contributing

If you'd like to contribute to this project, feel free to fork the repository and submit pull requests. Contributions are welcome, whether it's bug fixes, feature enhancements, or documentation improvements.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

For questions or collaboration opportunities, feel free to contact us at monishkumarpecai@gmail.com.

---

## Cancer screening information

The `/screening` page collects optional warning-sign and health-history answers to help users prepare for a conversation with a qualified health worker. It provides action guidance only; it does not calculate cancer risk, match symptoms to a cancer type, or rule cancer out. Results include a WHO-sourced list of common cancer types for general education, clearly marked as unrelated to the user's answers. The editable content and source metadata are in `cancer_screening_rules.json`.

The application does not persist screening answers. The hosting environment may keep separate technical logs. Deploy behind HTTPS before collecting sensitive health information; this repository does not configure TLS or guarantee encryption supplied by a hosting provider. App-wide CORS is disabled and Flask debug mode is off.

The screening interface uses separate in-page steps for symptoms, optional health history, results, general cancer information, and nearby facilities. Users can move back and forth without losing their current answers or scroll through all sections at once.

The listed WHO sources provide general early-diagnosis context, not a Zimbabwe-specific screening protocol. Have a qualified local clinician review any future screening or triage rule changes before publishing them.

After a result, users can enter a Zimbabwe city to rank the currently listed facilities by approximate straight-line distance from that city's centre. City matching happens in the browser; it is not sent to the server or saved. The editable locations and fictional sample oncologist profiles are in `medical_facilities.json`. The facilities are real map-listed institutions, but this directory does not verify oncology services, availability, referrals, or opening hours. Sample oncologists are fictional placeholders and are not affiliated with any listed facility. Facility location data is attributed to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); distances are not driving distances. Users should contact a facility before travelling.

## Articles

The `/articles` page reads its entries from `articles.json`. Add each article's title, slug, category, summary, author, ISO-formatted date, sources, and content sections there; each content section can contain a heading, paragraphs, and optional list items. The site calculates read time from the article text and provides search, category filters, source links, related articles, and a link back to screening. Keep nutrition and prevention claims aligned with the cited sources and avoid presenting general information as individual medical advice.

Survivor Stories entries must include a `consent` boolean. Only publish a real person's story when written permission has been obtained; set `consent` to `true` only for that approved story so the "Shared with permission" label is accurate. An unconsented article is hidden unless explicitly marked as a non-personal editorial `placeholder`. The included Survivor Stories entry is a consent-false placeholder, not a real person's account.

## Deploying on Render

Create a Python Web Service from the `main` branch (not a Static Site). Use:

- Build command: `pip install -r requirements-render.txt`
- Start command: `gunicorn --bind 0.0.0.0:$PORT app:app`

`.python-version` keeps the deployment on Python 3.13, matching the tested local environment. Render provides managed HTTPS and redirects HTTP requests. Free instances sleep when idle and have limited memory; use this deployment for a demo, not a production medical service.

---
