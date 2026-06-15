"""Merge Arnout's PDF annotations into app/data/questions.json.

The base question extractor reads page text. Arnout's notes are Acrobat
annotations authored by "Arnout Van Avermaet", so they need a separate pass
over the PDF annotation layer.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "source" / "GoogleMLEquestion1to285.pdf"
QUESTIONS_PATH = ROOT / "app" / "data" / "questions.json"
AUTHOR_RE = re.compile(r"arnout", re.IGNORECASE)
ANSWER_KEYS = {"A", "B", "C", "D", "E", "F"}
QUESTION_HEADING_RE = re.compile(r"^#(\d+)$")


@dataclass
class ArnoutAnnotation:
    page: int
    top: float
    subtype: str
    text: str


def clean_text(value: str) -> str:
    value = value.replace("\x00", "")
    value = value.replace("\u0090", "'")
    value = value.replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def question_headings_by_page() -> dict[int, list[tuple[float, int]]]:
    headings: dict[int, list[tuple[float, int]]] = {}
    with pdfplumber.open(PDF_PATH) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            words = page.extract_words()
            page_headings: list[tuple[float, int]] = []
            for index, word in enumerate(words[:-1]):
                if word["text"] != "Question":
                    continue
                match = QUESTION_HEADING_RE.match(words[index + 1]["text"])
                if match:
                    page_headings.append((float(word["top"]), int(match.group(1))))
            headings[page_index] = sorted(page_headings)
    return headings


def fallback_question_for_page(questions: list[dict[str, Any]], page: int) -> int | None:
    matches = [item["id"] for item in questions if page in item.get("sourcePages", [])]
    return min(matches) if matches else None


def question_for_annotation(annotation: ArnoutAnnotation, headings: dict[int, list[tuple[float, int]]], questions: list[dict[str, Any]]) -> int | None:
    page_headings = headings.get(annotation.page, [])
    preceding = [question_id for top, question_id in page_headings if top <= annotation.top + 8]
    if preceding:
        return preceding[-1]
    return fallback_question_for_page(questions, annotation.page)


def extract_annotations() -> list[ArnoutAnnotation]:
    reader = PdfReader(str(PDF_PATH))
    annotations: list[ArnoutAnnotation] = []

    for page_index, page in enumerate(reader.pages, start=1):
        height = float(page.mediabox.height)
        for annotation_ref in page.get("/Annots") or []:
            annotation = annotation_ref.get_object()
            author = str(annotation.get("/T", ""))
            if not AUTHOR_RE.search(author):
                continue

            text = clean_text(str(annotation.get("/Contents", "")))
            if not text:
                continue

            rect = annotation.get("/Rect") or [0, 0, 0, height]
            top = height - float(rect[3])
            subtype = str(annotation.get("/Subtype", ""))
            annotations.append(ArnoutAnnotation(page=page_index, top=top, subtype=subtype, text=text))

    return annotations


def answer_from_text(text: str) -> str:
    negative_patterns = [
        r"\b([A-F])\s+is\s+(?:wrong|not\s+(?:suitable|correct|best))\b",
        r"\b([A-F])\s*:\s*(?:may\s+not|not\s+|while\b)",
    ]
    negative = {match.group(1).upper() for pattern in negative_patterns for match in re.finditer(pattern, text, re.IGNORECASE)}

    positive_patterns = [
        r"\b([A-F])\s+(?:is|would\s+be)\s+(?:the\s+)?(?:correct|best|better)\b",
        r"\b([A-F])\s+(?:seems|looks)\s+(?:most\s+)?(?:likely|correct|best)\b",
        r"\b(?:answer|ans)\s*(?:is|:)\s*([A-F])\b",
        r"\b(?:probably|likely|most\s+likely|pretty\s+sure\s+(?:it'?s|its))\s+([A-F])\b",
        r"\b([A-F])\s*(?:\(\d{1,3}%\))",
    ]

    for pattern in positive_patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            answer = match.group(1).upper()
            if answer in ANSWER_KEYS and answer not in negative:
                return answer

    return ""


def is_comment_annotation(annotation: ArnoutAnnotation) -> bool:
    if annotation.subtype != "/FreeText":
        return False
    if len(annotation.text) > 700:
        return False
    if re.search(r"\bQuestion #\d+\b|Correct Answer:|Community vote distribution", annotation.text):
        return False
    return True


def merge_annotations() -> dict[str, int]:
    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))
    headings = question_headings_by_page()
    annotations = extract_annotations()
    by_question: dict[int, list[ArnoutAnnotation]] = {}

    for annotation in annotations:
        question_id = question_for_annotation(annotation, headings, questions)
        if question_id:
            by_question.setdefault(question_id, []).append(annotation)

    questions_with_comment = 0
    questions_with_answer = 0

    for item in questions:
        item["arnoutsComment"] = ""
        item["arnoutsAnswer"] = ""
        notes = by_question.get(item["id"], [])
        comments = [note.text for note in notes if is_comment_annotation(note)]
        if comments:
            item["arnoutsComment"] = "\n".join(dict.fromkeys(comments))
            questions_with_comment += 1

        for note in comments + [note.text for note in notes if note.subtype == "/Circle"]:
            answer = answer_from_text(note)
            if answer:
                item["arnoutsAnswer"] = answer
                questions_with_answer += 1
                break

    QUESTIONS_PATH.write_text(json.dumps(questions, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {
        "annotationsFound": len(annotations),
        "questionsWithArnoutComment": questions_with_comment,
        "questionsWithArnoutAnswer": questions_with_answer,
    }


def main() -> int:
    stats = merge_annotations()
    print("Arnout annotation extraction summary")
    for key, value in stats.items():
        print(f"- {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
