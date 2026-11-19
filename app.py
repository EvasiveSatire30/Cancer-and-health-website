import json
from pathlib import Path

from flask import Flask, render_template, request, jsonify, make_response

from cancer_screening import SCREENING_RULES, build_screening_result
from chat import get_response

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True

FACILITY_DIRECTORY_PATH = Path(__file__).resolve().parent / "medical_facilities.json"
with FACILITY_DIRECTORY_PATH.open(encoding="utf-8") as directory_file:
    FACILITY_DIRECTORY = json.load(directory_file)

@app.get("/")
def index_get():
    return render_template("base.html")

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

