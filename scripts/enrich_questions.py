"""Add tags and generated explanations to app/data/questions.json.

Tags and local explanations are generated with deterministic rules. Optional
Gemini generation is available behind --generate-api-explanations, but the
default explanation path does not use a network call or API credits.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_PATH = ROOT / "app" / "data" / "questions.json"
ENV_PATH = ROOT / ".env.local"

TAGS = [
    "Data pipelines & processing",
    "BigQuery & analytics",
    "Vertex AI / AI Platform training",
    "AutoML & prebuilt ML APIs",
    "Deployment & serving",
    "Monitoring, evaluation & model quality",
    "Data preparation & feature engineering",
    "Algorithms & problem framing",
    "Deep learning & TensorFlow",
    "MLOps, CI/CD & orchestration",
    "Security, privacy & compliance",
    "Explainability & responsible AI",
]

TAG_RULES: dict[str, list[str]] = {
    "Data pipelines & processing": [
        "dataflow",
        "dataproc",
        "pub/sub",
        "pubsub",
        "cloud storage",
        "etl",
        "elt",
        "stream",
        "streaming",
        "batch processing",
        "ingestion",
        "data fusion",
        "pipeline",
        "preprocess raw data",
    ],
    "BigQuery & analytics": [
        "bigquery",
        "bigquery ml",
        "sql",
        "analytics",
        "warehouse",
        "federated",
        "pandas dataframe",
        "ansi-2011",
    ],
    "Vertex AI / AI Platform training": [
        "vertex ai training",
        "ai platform training",
        "custom training",
        "training job",
        "custom container",
        "managed training",
        "gpu",
        "tpu",
        "hypertuning",
        "hyperparameter",
        "deep learning vm",
        "workbench",
    ],
    "AutoML & prebuilt ML APIs": [
        "automl",
        "auto ml",
        "cloud natural language",
        "natural language api",
        "vision api",
        "translation",
        "translate",
        "speech-to-text",
        "document ai",
        "recommendations ai",
        "prebuilt",
        "no code",
        "without writing code",
    ],
    "Deployment & serving": [
        "endpoint",
        "endpoints",
        "online prediction",
        "batch prediction",
        "prediction",
        "serving",
        "serve",
        "model version",
        "tensorflow serving",
        "latency",
        "deployed",
        "deploy",
        "traffic split",
    ],
    "Monitoring, evaluation & model quality": [
        "monitor",
        "monitoring",
        "skew",
        "drift",
        "continuous evaluation",
        "accuracy",
        "precision",
        "recall",
        "threshold",
        "auc",
        "roc",
        "evaluation",
        "evaluate",
        "model quality",
        "confusion matrix",
    ],
    "Data preparation & feature engineering": [
        "feature",
        "features",
        "preprocessing",
        "preprocess",
        "imbalanced",
        "class imbalance",
        "train/validation/test",
        "validation",
        "test dataset",
        "split",
        "time column",
        "label",
        "labels",
        "normalization",
        "one-hot",
        "tfrecord",
        "tfrecords",
    ],
    "Algorithms & problem framing": [
        "classification",
        "classifier",
        "regression",
        "clustering",
        "recommendation",
        "recommend",
        "forecast",
        "forecasting",
        "anomaly",
        "ranking",
        "lifetime value",
        "churn",
        "object detection",
        "semantic segmentation",
    ],
    "Deep learning & TensorFlow": [
        "tensorflow",
        "keras",
        "neural network",
        "cnn",
        "rnn",
        "lstm",
        "softmax",
        "loss function",
        "tf.data",
        "tensor",
        "tensorboard",
        "pytorch",
        "xgboost",
        "resnet",
    ],
    "MLOps, CI/CD & orchestration": [
        "kubeflow",
        "pipelines",
        "pipeline",
        "cloud build",
        "cloud composer",
        "schedule",
        "scheduled",
        "orchestration",
        "ci/cd",
        "version control",
        "cloud source repositories",
        "workflow",
        "automated",
        "retraining",
    ],
    "Security, privacy & compliance": [
        "pii",
        "dlp",
        "iam",
        "encryption",
        "encrypt",
        "regional",
        "region",
        "compliance",
        "sensitive",
        "privacy",
        "security",
        "fraud",
        "access",
    ],
    "Explainability & responsible AI": [
        "explainable",
        "explanation",
        "explanations",
        "feature attribution",
        "attribution",
        "fairness",
        "bias",
        "interpretable",
        "interpretability",
        "transparent",
        "shapley",
        "integrated gradients",
        "xrai",
        "responsible",
    ],
}


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        return values
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def question_text(question: dict[str, Any]) -> str:
    choices = question.get("choices", {})
    choice_text = " ".join(str(value) for value in choices.values()) if isinstance(choices, dict) else ""
    return f"{question.get('question', '')} {choice_text}".lower()


def classify_tags(question: dict[str, Any]) -> list[str]:
    text = question_text(question)
    scored: list[tuple[int, int, str]] = []
    for order, tag in enumerate(TAGS):
        score = 0
        for keyword in TAG_RULES[tag]:
            score += len(re.findall(rf"(?<![a-z0-9]){re.escape(keyword.lower())}(?![a-z0-9])", text))
        if score:
            scored.append((-score, order, tag))

    tags = [tag for _, _, tag in sorted(scored)]
    if not tags:
        tags = ["Algorithms & problem framing"]
    return tags


def best_answer_signal(question: dict[str, Any]) -> str:
    arnout = question.get("arnoutsAnswer")
    if isinstance(arnout, str) and arnout:
        return f"Arnout's answer: {arnout}"

    votes = question.get("voteDistribution", {})
    if not isinstance(votes, dict) or not votes:
        return "No answer signal is available."
    numeric_votes = {key: value for key, value in votes.items() if isinstance(value, (int, float))}
    if not numeric_votes:
        return "No answer signal is available."
    top = max(numeric_votes.values())
    winners = [key for key, value in numeric_votes.items() if value == top]
    return f"Highest community vote: {', '.join(winners)} at {top}%"


def best_answer_keys(question: dict[str, Any]) -> list[str]:
    arnout = question.get("arnoutsAnswer")
    choices = question.get("choices", {})
    if isinstance(arnout, str) and arnout and isinstance(choices, dict) and arnout in choices:
        return [arnout]

    votes = question.get("voteDistribution", {})
    if not isinstance(votes, dict):
        return []
    numeric_votes = {key: value for key, value in votes.items() if isinstance(value, (int, float))}
    if not numeric_votes:
        return []
    top = max(numeric_votes.values())
    return [key for key, value in numeric_votes.items() if value == top]


TAG_CONCEPTS = {
    "Data pipelines & processing": "Focus on the managed data movement and transformation service that matches the ingestion pattern: streaming events usually point to Pub/Sub and Dataflow, while batch Spark-style processing often points to Dataproc.",
    "BigQuery & analytics": "Look for the option that keeps analytics close to BigQuery and uses SQL or BigQuery ML when the question asks for low-effort warehouse-native analysis.",
    "Vertex AI / AI Platform training": "Prefer managed Vertex AI or AI Platform training when the scenario requires custom code, custom containers, GPUs/TPUs, hyperparameter tuning, or scalable managed training infrastructure.",
    "AutoML & prebuilt ML APIs": "Use AutoML or prebuilt APIs when the goal is to minimize model-development effort and the problem matches a supported managed task.",
    "Deployment & serving": "For serving questions, match the latency and access pattern: endpoints for online prediction, batch prediction for offline jobs, and versioned deployments when traffic control or rollback matters.",
    "Monitoring, evaluation & model quality": "Evaluation questions usually hinge on choosing the metric or monitoring feature that matches the failure mode: drift/skew, threshold tuning, precision/recall, or continuous evaluation.",
    "Data preparation & feature engineering": "Preparation questions are usually about preventing leakage, choosing the right split, making features reusable, or applying preprocessing consistently between training and serving.",
    "Algorithms & problem framing": "First identify the ML task type: classification, regression, forecasting, recommendation, clustering, or anomaly detection. The correct service or metric usually follows from that framing.",
    "Deep learning & TensorFlow": "For TensorFlow and deep learning questions, pay attention to input pipeline efficiency, tensor shapes, model architecture requirements, accelerators, and serving signatures.",
    "MLOps, CI/CD & orchestration": "MLOps questions usually reward managed orchestration, reproducibility, scheduled retraining, CI/CD automation, and versioned pipeline components.",
    "Security, privacy & compliance": "Security questions prioritize least privilege, encryption, regional constraints, DLP/PII handling, and avoiding unnecessary data movement.",
    "Explainability & responsible AI": "Explainability questions depend on model type and use case: feature attribution for tabular or structured models, image methods for vision models, and fairness checks when bias is the risk.",
}


def sentence(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return ""
    return value if value.endswith((".", "?", "!")) else f"{value}."


def compact(value: str, limit: int = 180) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def local_explanation(question: dict[str, Any]) -> str:
    choices = question.get("choices", {})
    if not isinstance(choices, dict):
        choices = {}

    tags = [tag for tag in question.get("tags", []) if tag in TAG_CONCEPTS]
    answer_keys = best_answer_keys(question)
    answer_label = "/".join(answer_keys) if answer_keys else "Needs review"
    answer_text = " / ".join(compact(str(choices.get(key, "")), 220) for key in answer_keys if key in choices)
    signal = best_answer_signal(question)
    arnout_comment = sentence(str(question.get("arnoutsComment") or ""))

    concept_lines = [TAG_CONCEPTS[tag] for tag in tags[:2]]
    if not concept_lines:
        concept_lines = [TAG_CONCEPTS["Algorithms & problem framing"]]

    weaker_choices = []
    for key, value in choices.items():
        if key in answer_keys:
            continue
        weaker_choices.append(f"**{key}** is less likely because `{compact(str(value), 120)}` does not align as directly with the stated constraints.")
        if len(weaker_choices) == 3:
            break

    if answer_keys:
        best = f"**Best local answer signal: {answer_label}.** {signal}. The matching choice is: `{answer_text}`."
        why = "This answer is the strongest local choice because it best matches the service pattern and constraints in the prompt."
    else:
        best = "**Best local answer signal: needs review.** No Arnout answer or community vote was available, so treat this as a study guide rather than a final key."
        why = "Use the tags and choice comparison to reason from the requirements before marking the question."

    parts = [
        best,
        f"**Core idea:** {' '.join(concept_lines)}",
        f"**Why it fits:** {why}",
    ]

    if arnout_comment:
        parts.append(f"**Arnout note:** {arnout_comment}")

    if weaker_choices:
        parts.append("**Why the alternatives are weaker:** " + " ".join(weaker_choices))

    parts.append("**Exam trap:** do not pick a service only because it is familiar; match the managed-service level, latency pattern, data location, and operational constraint named in the question.")
    return "\n\n".join(parts)


def build_explanation_prompt(question: dict[str, Any]) -> str:
    choices = question.get("choices", {})
    choices_text = "\n".join(f"{key}. {value}" for key, value in choices.items()) if isinstance(choices, dict) else ""
    votes = question.get("voteDistribution", {})
    votes_text = json.dumps(votes, ensure_ascii=False, sort_keys=True) if isinstance(votes, dict) and votes else "No community voting data."
    tags = ", ".join(question.get("tags", []))
    return f"""Create a concise, high-quality study explanation for this Google Cloud MLE certification-style question.

Use only the supplied question, choices, community votes, and Arnout note. Community votes can be wrong. Arnout's answer is the preferred local key when provided, but still verify it technically.

Return final user-visible Markdown only. Do not reveal chain-of-thought. Keep it around 180-260 words.

Question #{question.get("id")}
Tags: {tags}
Question: {question.get("question")}

Choices:
{choices_text}

Community votes: {votes_text}
{best_answer_signal(question)}
Arnout's comment: {question.get("arnoutsComment") or "None"}

Explain:
- the best answer,
- why it fits,
- why the main alternatives are weaker,
- any useful exam trap.
"""


def extract_gemini_text(data: dict[str, Any]) -> str:
    parts: list[str] = []
    for candidate in data.get("candidates", []):
        content = candidate.get("content", {}) if isinstance(candidate, dict) else {}
        for part in content.get("parts", []):
            if isinstance(part, dict) and not part.get("thought") and isinstance(part.get("text"), str):
                parts.append(part["text"])
    return "".join(parts).strip()


def generate_with_gemini(prompt: str, api_key: str, model: str, timeout: int) -> str:
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": 550,
            "temperature": 0.2,
            "thinkingConfig": {"thinkingBudget": 512},
        },
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    text = extract_gemini_text(data)
    if not text:
        raise RuntimeError("Gemini returned no visible explanation text.")
    return text


def enrich_questions(generate_api_explanations: bool, generate_local_explanations: bool, model: str, limit: int | None, sleep_seconds: float, overwrite: bool) -> dict[str, Any]:
    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))
    env = read_env()
    api_key = env.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY", "")
    if generate_api_explanations and not api_key:
        raise RuntimeError("GEMINI_API_KEY is required to generate explanations.")

    generated = 0
    local_generated = 0
    failed: list[dict[str, str]] = []
    for question in questions:
        question["tags"] = classify_tags(question)
        question.setdefault("explanation", "")
        if generate_local_explanations and (overwrite or not str(question.get("explanation", "")).strip()):
            question["explanation"] = local_explanation(question)
            local_generated += 1

    explanation_targets = [
        question
        for question in questions
        if generate_api_explanations and (overwrite or not str(question.get("explanation", "")).strip())
    ]
    if limit is not None:
        explanation_targets = explanation_targets[:limit]

    for index, question in enumerate(explanation_targets, start=1):
        try:
            question["explanation"] = generate_with_gemini(build_explanation_prompt(question), api_key, model, timeout=90)
            generated += 1
            print(f"[{index}/{len(explanation_targets)}] generated explanation for question {question['id']}")
            if sleep_seconds:
                time.sleep(sleep_seconds)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as error:
            failed.append({"id": str(question.get("id")), "error": str(error)})
            print(f"[{index}/{len(explanation_targets)}] failed question {question.get('id')}: {error}")

    QUESTIONS_PATH.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {
        "questions": len(questions),
        "tagged": sum(1 for question in questions if question.get("tags")),
        "withExplanation": sum(1 for question in questions if str(question.get("explanation", "")).strip()),
        "generatedLocalExplanations": local_generated,
        "generatedApiExplanations": generated,
        "failedExplanations": failed,
        "model": model if generate_api_explanations else None,
    }
    report_path = ROOT / "scripts" / "enrichment-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-local-explanations", action="store_true", help="Fill explanations locally without API calls.")
    parser.add_argument("--generate-api-explanations", action="store_true", help="Call Gemini to fill missing explanation fields.")
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    report = enrich_questions(
        generate_api_explanations=args.generate_api_explanations,
        generate_local_explanations=args.generate_local_explanations,
        model=args.model,
        limit=args.limit,
        sleep_seconds=args.sleep,
        overwrite=args.overwrite,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
