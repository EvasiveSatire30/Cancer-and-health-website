import json
from pathlib import Path

from flask import Flask, abort, render_template, request, jsonify, make_response

from cancer_screening import SCREENING_RULES, build_screening_result
from chat import get_response

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True

FACILITY_DIRECTORY_PATH = Path(__file__).resolve().parent / "medical_facilities.json"
with FACILITY_DIRECTORY_PATH.open(encoding="utf-8") as directory_file:
    FACILITY_DIRECTORY = json.load(directory_file)

ARTICLE_DATA_PATH = Path(__file__).resolve().parent / "articles.json"
with ARTICLE_DATA_PATH.open(encoding="utf-8") as articles_file:
    ARTICLE_DATA = json.load(articles_file)

ARTICLE_CATEGORIES = (
    "Prevention and Lifestyle",
    "Foods and Nutrition",
    "Warning Signs",
    "Screening and Check-ups",
    "Survivor Stories",
)


def _article_text(article):
    content = []
    for section in article["content"]:
        content.extend(section.get("paragraphs", []))
        content.extend(section.get("items", []))
    return " ".join(content)


def _article_read_time(article):
    words = len(_article_text(article).split())
    return max(1, (words + 199) // 200)


def _visible_articles():
    return [
        dict(article, read_time_minutes=_article_read_time(article))
        for article in ARTICLE_DATA
        if article["category"] != "Survivor Stories"
        or article.get("consent") is True
        or article.get("placeholder") is True
    ]


def _article_search_text(article):
    return " ".join(
        (
            article["title"],
            article["summary"],
            article["category"],
            _article_text(article),
        )
    ).casefold()


@app.get("/")
def index_get():
    return render_template("base.html")


@app.get("/articles")
def articles_index():
    query = request.args.get("q", "").strip()[:100]
    category = request.args.get("category", "").strip()
    if category and category not in ARTICLE_CATEGORIES:
        abort(404)

    articles = _visible_articles()
    if category:
        articles = [article for article in articles if article["category"] == category]
    if query:
        normalized_query = query.casefold()
        articles = [
            article
            for article in articles
            if normalized_query in _article_search_text(article)
        ]

    return render_template(
        "articles.html",
        articles=articles,
        categories=ARTICLE_CATEGORIES,
        search_query=query,
        selected_category=category,
    )


@app.get("/articles/<slug>")
def article_detail(slug):
    articles = _visible_articles()
    article = next((item for item in articles if item["slug"] == slug), None)
    if article is None:
        abort(404)

    related_articles = [
        item for item in articles if item["slug"] != article["slug"]
    ]
    related_articles.sort(
        key=lambda item: (
            item["category"] != article["category"],
            item["title"].casefold(),
        )
    )

    return render_template(
        "article_detail.html",
        article=article,
        related_articles=related_articles[:3],
    )


@app.get("/screening")
def cancer_screening():
    return render_template(
        "screening.html",
        rules=SCREENING_RULES,
        facility_directory=FACILITY_DIRECTORY,
    )

@app.post("/screening/results")
def cancer_screening_results():
    payload = request.get_json(silent=True)
    try:
        result = build_screening_result(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    response = make_response(jsonify(result))
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return response

@app.after_request
def disable_screening_caching(response):
    if (
        request.path == "/screening"
        or request.path.startswith("/screening/")
        or request.path == "/static/screening.js"
    ):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
    return response

@app.route('/login')
def login():
    return render_template("login.html")

@app.route('/admin')
def admin():
    return render_template("admin.html")

@app.route('/about')
def about_us():
    return render_template("about_us.html")


@app.post("/predict")
def predict():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON request body is required."}), 400

    text = payload.get("message")
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "Message must be a non-empty string."}), 400

    text = text.strip()
    response = get_response(text)
    return jsonify({"answer": response})

if __name__ == "__main__":
    app.run(debug=False)

