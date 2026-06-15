"""Extract meaningful question images from the PDF into public/question-images.

This pass intentionally updates only image-related data:
- public/question-images/qNNN-M.png files
- app/data/questions.json images arrays
- scripts/extraction-report.json image extraction fields
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "source" / "GoogleMLEquestion1to285.pdf"
QUESTIONS_PATH = ROOT / "app" / "data" / "questions.json"
IMAGE_DIR = ROOT / "public" / "question-images"
REPORT_PATH = ROOT / "scripts" / "extraction-report.json"

MIN_IMAGE_WIDTH = 100
MIN_IMAGE_HEIGHT = 70
MIN_IMAGE_AREA = 7_500
MIN_RENDERED_BOX_WIDTH = 90
MIN_RENDERED_BOX_HEIGHT = 45
REPEATED_DECORATION_MIN_PAGES = 8
REPEATED_BBOX_TOLERANCE = 8
CROP_PADDING = 12
RENDER_SCALE = 2.5

QUESTION_HEADING_RE = re.compile(r"^Question\s+#(\d+)\b")
COMMUNITY_RE = re.compile(r"Community vote distribution", re.IGNORECASE)


@dataclass(frozen=True)
class QuestionBoundary:
    question_id: int
    page_index: int
    y: float


@dataclass(frozen=True)
class CandidateImage:
    page_index: int
    xref: int
    width: int
    height: int
    rect: fitz.Rect


def line_items(page: fitz.Page) -> list[tuple[float, str]]:
    words = page.get_text("words")
    rows: dict[int, list[tuple[float, str]]] = defaultdict(list)
    for x0, y0, _x1, _y1, text, *_rest in words:
        rows[round(y0 / 3)].append((x0, text))

    lines: list[tuple[float, str]] = []
    for row, parts in rows.items():
        text = " ".join(part for _x, part in sorted(parts))
        lines.append((row * 3.0, text))
    return sorted(lines)


def question_boundaries(doc: fitz.Document) -> list[QuestionBoundary]:
    boundaries: list[QuestionBoundary] = []
    for page_index, page in enumerate(doc):
        for y, text in line_items(page):
            match = QUESTION_HEADING_RE.match(text.strip())
            if match:
                boundaries.append(QuestionBoundary(int(match.group(1)), page_index, y))
    return sorted(boundaries, key=lambda item: (item.page_index, item.y))


def community_cutoffs(doc: fitz.Document) -> dict[tuple[int, int], float]:
    cutoffs: dict[tuple[int, int], float] = {}
    current_question_id: int | None = None
    for page_index, page in enumerate(doc):
        for y, text in line_items(page):
            heading_match = QUESTION_HEADING_RE.match(text.strip())
            if heading_match:
                current_question_id = int(heading_match.group(1))
            elif current_question_id and COMMUNITY_RE.search(text):
                cutoffs.setdefault((current_question_id, page_index), y)
    return cutoffs


def image_key(candidate: CandidateImage) -> tuple[int, int, int, int, int, int]:
    rect = candidate.rect
    return (
        candidate.width,
        candidate.height,
        round(rect.x0 / REPEATED_BBOX_TOLERANCE),
        round(rect.y0 / REPEATED_BBOX_TOLERANCE),
        round(rect.x1 / REPEATED_BBOX_TOLERANCE),
        round(rect.y1 / REPEATED_BBOX_TOLERANCE),
    )


def all_image_candidates(doc: fitz.Document) -> list[CandidateImage]:
    candidates: list[CandidateImage] = []
    for page_index, page in enumerate(doc):
        for image in page.get_images(full=True):
            xref = image[0]
            width = int(image[2])
            height = int(image[3])
            for rect in page.get_image_rects(xref):
                candidates.append(CandidateImage(page_index, xref, width, height, rect))
    return candidates


def repeated_image_keys(candidates: list[CandidateImage]) -> set[tuple[int, int, int, int, int, int]]:
    page_numbers: dict[tuple[int, int, int, int, int, int], set[int]] = defaultdict(set)
    for candidate in candidates:
        page_numbers[image_key(candidate)].add(candidate.page_index)
    return {key for key, pages in page_numbers.items() if len(pages) >= REPEATED_DECORATION_MIN_PAGES}


def is_meaningful_image(candidate: CandidateImage, repeated_keys: set[tuple[int, int, int, int, int, int]]) -> bool:
    rect = candidate.rect
    box_width = rect.width
    box_height = rect.height
    box_area = box_width * box_height
    if image_key(candidate) in repeated_keys:
        return False
    if candidate.width < MIN_IMAGE_WIDTH or candidate.height < MIN_IMAGE_HEIGHT:
        return False
    if box_width < MIN_RENDERED_BOX_WIDTH or box_height < MIN_RENDERED_BOX_HEIGHT:
        return False
    return box_area >= MIN_IMAGE_AREA


def bounds_for_question(boundaries: list[QuestionBoundary], question_id: int, page_count: int) -> tuple[QuestionBoundary | None, QuestionBoundary | None]:
    for index, boundary in enumerate(boundaries):
        if boundary.question_id == question_id:
            next_boundary = boundaries[index + 1] if index + 1 < len(boundaries) else QuestionBoundary(question_id + 1, page_count, 0)
            return boundary, next_boundary
    return None, None


def image_is_inside_question(
    candidate: CandidateImage,
    start: QuestionBoundary,
    end: QuestionBoundary,
    cutoffs: dict[tuple[int, int], float],
) -> bool:
    if candidate.page_index < start.page_index or candidate.page_index > end.page_index:
        return False
    center_y = (candidate.rect.y0 + candidate.rect.y1) / 2
    if candidate.page_index == start.page_index and center_y < start.y:
        return False
    if candidate.page_index == end.page_index and end.question_id != start.question_id and center_y >= end.y:
        return False

    cutoff = cutoffs.get((start.question_id, candidate.page_index))
    if cutoff is not None and candidate.rect.y0 >= cutoff:
        return False
    return True


def padded_rect(rect: fitz.Rect, page: fitz.Page) -> fitz.Rect:
    return fitz.Rect(
        max(page.rect.x0, rect.x0 - CROP_PADDING),
        max(page.rect.y0, rect.y0 - CROP_PADDING),
        min(page.rect.x1, rect.x1 + CROP_PADDING),
        min(page.rect.y1, rect.y1 + CROP_PADDING),
    )


def extract_images() -> dict[str, Any]:
    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for existing in IMAGE_DIR.glob("q[0-9][0-9][0-9]-*.png"):
        existing.unlink()

    doc = fitz.open(PDF_PATH)
    boundaries = question_boundaries(doc)
    cutoffs = community_cutoffs(doc)
    candidates = all_image_candidates(doc)
    repeated_keys = repeated_image_keys(candidates)
    meaningful = [candidate for candidate in candidates if is_meaningful_image(candidate, repeated_keys)]

    extracted_paths: dict[int, list[str]] = {}
    uncertain: list[dict[str, Any]] = []

    for question in questions:
        question["images"] = []
        if not question.get("hasImage"):
            continue

        start, end = bounds_for_question(boundaries, int(question["id"]), len(doc))
        if not start or not end:
            uncertain.append({"questionId": question["id"], "reason": "question boundary not found"})
            continue

        matches = [
            candidate
            for candidate in meaningful
            if image_is_inside_question(candidate, start, end, cutoffs)
        ]
        matches.sort(key=lambda item: (item.page_index, item.rect.y0, item.rect.x0))

        for image_index, candidate in enumerate(matches, start=1):
            page = doc[candidate.page_index]
            clip = padded_rect(candidate.rect, page)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), clip=clip, alpha=False)
            filename = f"q{int(question['id']):03d}-{image_index}.png"
            output_path = IMAGE_DIR / filename
            pixmap.save(output_path)
            question["images"].append(f"/question-images/{filename}")

        if matches:
            extracted_paths[int(question["id"])] = list(question["images"])
        else:
            uncertain.append({"questionId": question["id"], "reason": "hasImage true but no meaningful embedded image found"})

    QUESTIONS_PATH.write_text(json.dumps(questions, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    has_image_ids = [int(question["id"]) for question in questions if question.get("hasImage")]
    extracted_ids = sorted(extracted_paths)
    missing_ids = [question_id for question_id in has_image_ids if question_id not in extracted_paths]
    image_report = {
        "questionsMarkedHasImage": has_image_ids,
        "questionsWithExtractedImages": extracted_ids,
        "questionsWithHasImageButNoExtractedImage": missing_ids,
        "extractedImagePaths": extracted_paths,
        "uncertainImageDetectionsRequiringManualReview": uncertain,
        "thresholds": {
            "minImageWidth": MIN_IMAGE_WIDTH,
            "minImageHeight": MIN_IMAGE_HEIGHT,
            "minImageArea": MIN_IMAGE_AREA,
            "minRenderedBoxWidth": MIN_RENDERED_BOX_WIDTH,
            "minRenderedBoxHeight": MIN_RENDERED_BOX_HEIGHT,
            "repeatedDecorationMinPages": REPEATED_DECORATION_MIN_PAGES,
            "repeatedBboxTolerance": REPEATED_BBOX_TOLERANCE,
            "cropPadding": CROP_PADDING,
            "renderScale": RENDER_SCALE,
        },
    }

    try:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        report = {}
    report["questionImageExtraction"] = image_report
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return image_report


def main() -> int:
    report = extract_images()
    print("Question image extraction summary")
    print(f"- Questions with hasImage: {len(report['questionsMarkedHasImage'])}")
    print(f"- Questions with extracted images: {len(report['questionsWithExtractedImages'])}")
    print(f"- Extracted image files: {sum(len(paths) for paths in report['extractedImagePaths'].values())}")
    print(f"- hasImage without extracted image: {report['questionsWithHasImageButNoExtractedImage']}")
    print(f"- Extraction report: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
