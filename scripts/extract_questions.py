"""Extract structured quiz questions from the source PDF.

Pipeline:
1. PyMuPDF extracts page text, page information, image metadata, and image boxes.
2. Python detects primary question boundaries.
3. A schema-versioned converter structures each primary question block.
4. Python validates, warns, caches, and writes JSON outputs.

The converter is intentionally local/deterministic unless an AI converter is
configured later. Cache keys include both raw question content and schema version
so older sample outputs are not reused for the expanded schema.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fitz


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "source" / "GoogleMLEquestion1to285.pdf"
DATA_DIR = ROOT / "app" / "data"
VALIDATION_OUTPUT_PATH = DATA_DIR / "questions.validation.json"
FINAL_OUTPUT_PATH = DATA_DIR / "questions.json"
WARNINGS_PATH = ROOT / "scripts" / "extraction-warnings.json"
REPORT_PATH = ROOT / "scripts" / "extraction-report.json"
CACHE_PATH = ROOT / "scripts" / ".extraction-cache.json"

SCHEMA_VERSION = "questions-v2-sourcePages-hasImage"
EXPECTED_START_ID = 1
EXPECTED_END_ID = 285
VALIDATION_END_ID = 10

MIN_MEANINGFUL_IMAGE_WIDTH = 120
MIN_MEANINGFUL_IMAGE_HEIGHT = 80
MIN_MEANINGFUL_IMAGE_AREA = 12_000
SUBSTANTIAL_PAGE_AREA_RATIO = 0.08
SMALL_ICON_MAX_WIDTH = 72
SMALL_ICON_MAX_HEIGHT = 72
REPEATED_DECORATION_MIN_PAGES = 8
REPEATED_BBOX_TOLERANCE = 8

QUESTION_RE = re.compile(r"(?m)^Question #(\d+)\s*$")
CHOICE_LINE_RE = re.compile(r"^([A-F])\.\s+(.*)")
UPVOTE_RE = re.compile(r"upvoted\s+(\d+)\s+times?", re.IGNORECASE)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")
NEW_QUESTION_RE = re.compile(r"(?i)(=+\s*new question|new question\s*\d+)")
BRAINDUMP_RE = re.compile(
    r"(?i)\b(dump|braindump|valid dump|exam dump|contributor access|gmail address|share the complete|validitexams|t\.ly/|actualexams)\b"
)
UNRELATED_RE = re.compile(
    r"(?i)\b(post new questions|only moderator can post|emailed the additional questions|questions were received off|^answer\??$)\b"
)
VISUAL_REFERENCE_RE = re.compile(
    r"(?i)\b(diagram|figure|chart|screenshot|illustration|graph|code sample|following code|following table|shown below|see below|shown in the|in the image|in this image|following image|architecture diagram)\b"
)


@dataclass
class PageInfo:
    number: int
    text: str
    width: float
    height: float
    images: list[dict[str, Any]]


@dataclass
class QuestionBlock:
    id: int
    text: str
    source_pages: list[int]


@dataclass
class RunStats:
    expected_question_count: int
    extracted_questions: list[dict[str, Any]] = field(default_factory=list)
    skipped_questions: list[dict[str, Any]] = field(default_factory=list)
    validation_failures: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    duplicate_question_ids: list[int] = field(default_factory=list)
    ai_requests_made: int = 0
    cached_responses_reused: int = 0
    total_pdf_pages_processed: int = 0


def normalize_text(value: str) -> str:
    replacements = {
        "\u00ad": "",
        "¬": "fi",
        "®": "ffi",
        "­": "fl",
        "`˜": "'",
        "ג€": '"',
        "Dataow": "Dataflow",
        "Kubeow": "Kubeflow",
        "workow": "workflow",
        "classication": "classification",
        "conrm": "confirm",
        "ecient": "efficient",
    }
    for before, after in replacements.items():
        value = value.replace(before, after)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def clean_comment_text(value: str) -> str:
    value = re.sub(r"Selected Answer:\s*[A-F]\s*", "", value)
    value = re.sub(r"Community vote distribution.*", "", value, flags=re.IGNORECASE | re.DOTALL)
    value = EMAIL_RE.sub("[email removed]", value)
    return normalize_text(value)


def load_cache() -> dict[str, Any]:
    if not CACHE_PATH.exists():
        return {"schemaVersion": SCHEMA_VERSION, "entries": {}}
    try:
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"schemaVersion": SCHEMA_VERSION, "entries": {}}
    if cache.get("schemaVersion") != SCHEMA_VERSION:
        return {"schemaVersion": SCHEMA_VERSION, "entries": {}}
    return {"schemaVersion": SCHEMA_VERSION, "entries": cache.get("entries", {})}


def save_cache(cache: dict[str, Any]) -> None:
    CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def cache_key(block: QuestionBlock) -> str:
    digest = hashlib.sha256()
    digest.update(SCHEMA_VERSION.encode("utf-8"))
    digest.update(b"\0")
    digest.update(str(block.id).encode("utf-8"))
    digest.update(b"\0")
    digest.update(block.text.encode("utf-8"))
    return digest.hexdigest()


def extract_pages() -> list[PageInfo]:
    if not PDF_PATH.exists():
        raise FileNotFoundError(f"PDF not found: {PDF_PATH}")

    pages: list[PageInfo] = []
    with fitz.open(PDF_PATH) as doc:
        for page_index, page in enumerate(doc):
            rect = page.rect
            images: list[dict[str, Any]] = []
            for image in page.get_images(full=True):
                xref = image[0]
                width = int(image[2])
                height = int(image[3])
                for image_rect in page.get_image_rects(xref):
                    bbox = [round(image_rect.x0, 2), round(image_rect.y0, 2), round(image_rect.x1, 2), round(image_rect.y1, 2)]
                    images.append({"xref": xref, "width": width, "height": height, "bbox": bbox})

            pages.append(
                PageInfo(
                    number=page_index + 1,
                    text=page.get_text("text"),
                    width=float(rect.width),
                    height=float(rect.height),
                    images=images,
                )
            )
    return pages


def repeated_image_keys(pages: list[PageInfo]) -> set[tuple[int, int, int, int, int, int]]:
    counts: dict[tuple[int, int, int, int, int, int], set[int]] = {}
    for page in pages:
        for image in page.images:
            x0, y0, x1, y1 = image["bbox"]
            key = (
                int(image["width"]),
                int(image["height"]),
                round(x0 / REPEATED_BBOX_TOLERANCE),
                round(y0 / REPEATED_BBOX_TOLERANCE),
                round(x1 / REPEATED_BBOX_TOLERANCE),
                round(y1 / REPEATED_BBOX_TOLERANCE),
            )
            counts.setdefault(key, set()).add(page.number)
    return {key for key, page_numbers in counts.items() if len(page_numbers) >= REPEATED_DECORATION_MIN_PAGES}


def detect_question_blocks(pages: list[PageInfo], start_id: int, end_id: int) -> list[QuestionBlock]:
    starts: list[tuple[int, int, re.Match[str]]] = []
    for page_index, page in enumerate(pages):
        for match in QUESTION_RE.finditer(page.text):
            question_id = int(match.group(1))
            if EXPECTED_START_ID <= question_id <= EXPECTED_END_ID:
                starts.append((question_id, page_index, match))

    starts.sort(key=lambda item: (item[1], item[2].start()))
    blocks: list[QuestionBlock] = []

    for index, (question_id, page_index, match) in enumerate(starts):
        if not (start_id <= question_id <= end_id):
            continue

        next_page_index = starts[index + 1][1] if index + 1 < len(starts) else len(pages) - 1
        next_match_start = starts[index + 1][2].start() if index + 1 < len(starts) and starts[index + 1][1] == page_index else None

        section_parts: list[str] = []
        source_pages: list[int] = []
        for current_page_index in range(page_index, next_page_index + 1):
            page_text = pages[current_page_index].text
            start = match.start() if current_page_index == page_index else 0
            end = next_match_start if current_page_index == next_page_index and next_match_start is not None else len(page_text)
            part = page_text[start:end]
            if part.strip():
                section_parts.append(part)
                source_pages.append(pages[current_page_index].number)

        blocks.append(QuestionBlock(id=question_id, text="\n".join(section_parts), source_pages=sorted(set(source_pages))))

    return blocks


def split_question_and_discussion(section: str) -> tuple[str, str]:
    comment_match = re.search(r"(?m)^.*?\s+", section)
    if not comment_match:
        return section, ""
    return section[: comment_match.start()], section[comment_match.start() :]


def extract_question_body(question_part: str) -> str:
    without_heading = QUESTION_RE.sub("", question_part, count=1)
    without_topic = re.sub(r"(?m)^Topic\s+\d+\s*$", "", without_heading)
    first_choice = re.search(r"(?m)^[A-F]\.\s+", without_topic)
    if not first_choice:
        return ""
    return normalize_text(without_topic[: first_choice.start()])


def extract_choices(question_part: str) -> dict[str, str]:
    choices: dict[str, str] = {}
    current_label: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_label, current_lines
        if current_label and current_lines:
            text = normalize_text("\n".join(current_lines))
            if text:
                choices[current_label] = text
        current_label = None
        current_lines = []

    for raw_line in question_part.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(("Correct Answer:", "Reference:")) or line.startswith(""):
            flush()
            break
        choice_match = CHOICE_LINE_RE.match(line)
        if choice_match:
            flush()
            current_label = choice_match.group(1)
            current_lines = [choice_match.group(2)]
        elif current_label:
            current_lines.append(line)

    flush()
    return choices


def extract_vote_distribution(section: str, warnings: list[dict[str, Any]], question_id: int) -> dict[str, int]:
    marker = re.search(r"Community vote distribution\s*(.*?)(?:\n\s*\n|upvoted|\n|Topic\s+\d+|Question #|\Z)", section, re.I | re.S)
    if not marker:
        return {}

    block = marker.group(1)
    distribution: dict[str, int] = {}
    for label, percent in re.findall(r"\b([A-F])\s*\((\d{1,3})%\)", block):
        distribution[label] = int(percent)

    unlabeled = re.findall(r"(?m)^\s*(\d{1,3})%\s*$", block)
    if unlabeled:
        warnings.append(
            {
                "type": "vote_distribution",
                "questionId": question_id,
                "message": f"Ignored unlabeled vote percentage(s): {', '.join(unlabeled)}",
                "manualReview": True,
            }
        )
    return distribution


def parse_comment_author(header: str) -> str:
    header = re.sub(r"[]", " ", header)
    header = re.sub(r"\b(Highly Voted|Most Recent)\b.*", "", header)
    header = re.sub(r"\s+\d+\s+(year|month|week|day|hour|minute).*", "", header)
    return normalize_text(header).split(" ")[0]


def extract_comments(discussion: str) -> list[dict[str, Any]]:
    if not discussion:
        return []

    starts = list(re.finditer(r"(?m)^.*?\s+.*$", discussion))
    comments: list[dict[str, Any]] = []

    for index, start in enumerate(starts):
        block_start = start.start()
        block_end = starts[index + 1].start() if index + 1 < len(starts) else len(discussion)
        block = discussion[block_start:block_end]
        lines = block.splitlines()
        if not lines:
            continue

        author = parse_comment_author(lines[0])
        vote_match = UPVOTE_RE.search(block)
        votes = int(vote_match.group(1)) if vote_match else 0
        body_start = block.find("\n")
        body = block[body_start + 1 :] if body_start >= 0 else ""
        body = UPVOTE_RE.sub("", body)
        text = clean_comment_text(body)

        if not author or not text:
            continue
        if EMAIL_RE.search(body) or BRAINDUMP_RE.search(body) or NEW_QUESTION_RE.search(body) or UNRELATED_RE.search(text):
            continue
        if len(text) < 8:
            continue

        comments.append({"author": author, "text": text, "votes": votes})

    comments.sort(key=lambda item: item["votes"], reverse=True)
    return comments[:5]


def image_key(image: dict[str, Any]) -> tuple[int, int, int, int, int, int]:
    x0, y0, x1, y1 = image["bbox"]
    return (
        int(image["width"]),
        int(image["height"]),
        round(x0 / REPEATED_BBOX_TOLERANCE),
        round(y0 / REPEATED_BBOX_TOLERANCE),
        round(x1 / REPEATED_BBOX_TOLERANCE),
        round(y1 / REPEATED_BBOX_TOLERANCE),
    )


def image_detection_for_block(
    block: QuestionBlock,
    pages_by_number: dict[int, PageInfo],
    repeated_keys: set[tuple[int, int, int, int, int, int]],
) -> tuple[bool, list[dict[str, Any]]]:
    details: list[dict[str, Any]] = []
    question_part, _discussion = split_question_and_discussion(block.text)
    text_mentions_visual = bool(VISUAL_REFERENCE_RE.search(question_part))

    for page_number in block.source_pages:
        page = pages_by_number[page_number]
        page_area = page.width * page.height
        for image in page.images:
            width = int(image["width"])
            height = int(image["height"])
            x0, y0, x1, y1 = image["bbox"]
            box_width = max(0.0, x1 - x0)
            box_height = max(0.0, y1 - y0)
            box_area = box_width * box_height

            if image_key(image) in repeated_keys:
                continue
            if width <= SMALL_ICON_MAX_WIDTH and height <= SMALL_ICON_MAX_HEIGHT:
                continue
            if box_width <= SMALL_ICON_MAX_WIDTH and box_height <= SMALL_ICON_MAX_HEIGHT:
                continue

            substantial = box_area / page_area >= SUBSTANTIAL_PAGE_AREA_RATIO
            meaningful_size = width >= MIN_MEANINGFUL_IMAGE_WIDTH and height >= MIN_MEANINGFUL_IMAGE_HEIGHT and box_area >= MIN_MEANINGFUL_IMAGE_AREA
            if substantial or meaningful_size or text_mentions_visual:
                reason = "substantial page image" if substantial else "meaningful image dimensions"
                if text_mentions_visual:
                    reason = "question text refers to visual content"
                details.append(
                    {
                        "type": "image_detection",
                        "questionId": block.id,
                        "sourcePage": page_number,
                        "imageDimensions": {"width": width, "height": height},
                        "bbox": image["bbox"],
                        "reason": reason,
                        "manualReview": text_mentions_visual and not substantial,
                    }
                )

    if text_mentions_visual and not details:
        details.append(
            {
                "type": "image_detection",
                "questionId": block.id,
                "sourcePage": block.source_pages[0],
                "imageDimensions": None,
                "bbox": None,
                "reason": "question text refers to visual content but no clear extracted image was found",
                "manualReview": True,
            }
        )

    return bool(details), details


def convert_block_locally(block: QuestionBlock, warnings: list[dict[str, Any]]) -> dict[str, Any]:
    question_part, discussion = split_question_and_discussion(block.text)
    return {
        "id": block.id,
        "question": extract_question_body(question_part),
        "choices": extract_choices(question_part),
        "voteDistribution": extract_vote_distribution(block.text, warnings, block.id),
        "comments": extract_comments(discussion),
        "sourcePages": block.source_pages,
        "hasImage": False,
    }


def validate_question(item: dict[str, Any], expected_id: int, pdf_page_count: int) -> list[str]:
    failures: list[str] = []
    if item.get("id") != expected_id:
        failures.append(f"id mismatch, expected {expected_id}, got {item.get('id')!r}")
    if not item.get("question"):
        failures.append("question is empty")

    choices = item.get("choices")
    if not isinstance(choices, dict) or not (2 <= len(choices) <= 6):
        failures.append(f"choices must contain 2-6 entries, got {len(choices) if isinstance(choices, dict) else 'invalid'}")
    elif any(not re.fullmatch(r"[A-Z]", key) for key in choices):
        failures.append("choice keys must be uppercase letters")

    vote_distribution = item.get("voteDistribution")
    if not isinstance(vote_distribution, dict):
        failures.append("voteDistribution must be an object")
    else:
        total = 0
        complete = choices and set(vote_distribution) == set(choices)
        for key, value in vote_distribution.items():
            if not re.fullmatch(r"[A-Z]", key):
                failures.append(f"voteDistribution key is not uppercase: {key}")
            if not isinstance(value, (int, float)) or value < 0 or value > 100:
                failures.append(f"vote percentage out of range for {key}: {value!r}")
            elif complete:
                total += value
        if complete and not (98 <= total <= 102):
            failures.append(f"complete vote distribution should total about 100, got {total}")

    source_pages = item.get("sourcePages")
    if not isinstance(source_pages, list) or not source_pages:
        failures.append("sourcePages must be a non-empty array")
    elif source_pages != sorted(set(source_pages)):
        failures.append("sourcePages must be sorted and unique")
    elif any(not isinstance(page, int) or page <= 0 or page > pdf_page_count for page in source_pages):
        failures.append("sourcePages contains page outside PDF page count")

    if not isinstance(item.get("hasImage"), bool):
        failures.append("hasImage must be a boolean")

    for index, comment in enumerate(item.get("comments", [])):
        text = comment.get("text", "") if isinstance(comment, dict) else ""
        if EMAIL_RE.search(text):
            failures.append(f"comment {index} contains an email address")

    return failures


def process_questions(start_id: int, end_id: int, output_path: Path) -> RunStats:
    pages = extract_pages()
    stats = RunStats(expected_question_count=end_id - start_id + 1, total_pdf_pages_processed=len(pages))
    pages_by_number = {page.number: page for page in pages}
    repeated_keys = repeated_image_keys(pages)
    blocks = detect_question_blocks(pages, start_id, end_id)
    cache = load_cache()
    entries = cache.setdefault("entries", {})
    seen_ids: set[int] = set()
    questions: list[dict[str, Any]] = []

    for block in blocks:
        if block.id in seen_ids:
            stats.duplicate_question_ids.append(block.id)
            stats.skipped_questions.append({"id": block.id, "reason": "duplicate id"})
            continue
        seen_ids.add(block.id)

        key = cache_key(block)
        cached = entries.get(key)
        if cached:
            item = cached
            stats.cached_responses_reused += 1
        else:
            item = convert_block_locally(block, stats.warnings)
            entries[key] = item

        has_image, image_warnings = image_detection_for_block(block, pages_by_number, repeated_keys)
        item = dict(item)
        item["sourcePages"] = block.source_pages
        item["hasImage"] = has_image
        stats.warnings.extend(image_warnings)

        failures = validate_question(item, block.id, len(pages))
        if failures:
            stats.validation_failures.append({"id": block.id, "failures": failures})
            stats.skipped_questions.append({"id": block.id, "reason": "validation failed"})
            continue

        questions.append(item)

    missing_ids = sorted(set(range(start_id, end_id + 1)) - seen_ids)
    for missing_id in missing_ids:
        stats.skipped_questions.append({"id": missing_id, "reason": "question heading not found"})

    questions.sort(key=lambda item: item["id"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(questions, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    stats.extracted_questions = questions
    save_cache(cache)
    return stats


def build_report(stats: RunStats, start_id: int, end_id: int) -> dict[str, Any]:
    extracted_ids = [item["id"] for item in stats.extracted_questions]
    expected_ids = set(range(start_id, end_id + 1))
    missing_ids = sorted(expected_ids - set(extracted_ids))
    missing_vote_distributions = [item["id"] for item in stats.extracted_questions if not item["voteDistribution"]]
    has_image_ids = [item["id"] for item in stats.extracted_questions if item["hasImage"]]
    uncertain_image_ids = sorted(
        {
            warning["questionId"]
            for warning in stats.warnings
            if warning.get("type") == "image_detection" and warning.get("manualReview")
        }
    )
    manual_review_warnings = [warning for warning in stats.warnings if warning.get("manualReview")]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "expectedQuestionCount": end_id - start_id + 1,
        "extractedQuestionCount": len(stats.extracted_questions),
        "extractedQuestionIds": extracted_ids,
        "missingQuestionIds": missing_ids,
        "duplicateQuestionIds": sorted(set(stats.duplicate_question_ids)),
        "skippedQuestions": stats.skipped_questions,
        "questionsMissingVoteDistributions": missing_vote_distributions,
        "questionsMarkedHasImage": has_image_ids,
        "questionsWithUncertainImageDetection": uncertain_image_ids,
        "validationFailures": stats.validation_failures,
        "aiRequestsMade": stats.ai_requests_made,
        "cachedResponsesReused": stats.cached_responses_reused,
        "totalPdfPagesProcessed": stats.total_pdf_pages_processed,
        "warningsRequiringManualReview": manual_review_warnings,
    }


def write_report_and_warnings(stats: RunStats, start_id: int, end_id: int) -> dict[str, Any]:
    report = build_report(stats, start_id, end_id)
    WARNINGS_PATH.write_text(json.dumps(stats.warnings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def print_summary(report: dict[str, Any]) -> None:
    print("Extraction summary")
    print(f"- Questions expected: {report['expectedQuestionCount']}")
    print(f"- Questions extracted: {report['extractedQuestionCount']}")
    print(f"- Questions skipped: {len(report['skippedQuestions'])}")
    print(f"- Missing question ids: {report['missingQuestionIds']}")
    print(f"- Questions marked hasImage: {report['questionsMarkedHasImage']}")
    print(f"- Questions requiring image review: {report['questionsWithUncertainImageDetection']}")
    print(f"- Missing vote distributions: {report['questionsMissingVoteDistributions']}")
    print(f"- AI requests made: {report['aiRequestsMade']}")
    print(f"- Cached responses reused: {report['cachedResponsesReused']}")
    print(f"- Validation failures: {len(report['validationFailures'])}")
    print(f"- Path to final JSON file: {FINAL_OUTPUT_PATH}")
    print(f"- Path to extraction report: {REPORT_PATH}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validation-only", action="store_true", help="Only regenerate questions 1 through 10.")
    args = parser.parse_args()

    validation_stats = process_questions(EXPECTED_START_ID, VALIDATION_END_ID, VALIDATION_OUTPUT_PATH)
    validation_report = build_report(validation_stats, EXPECTED_START_ID, VALIDATION_END_ID)
    if validation_report["validationFailures"]:
        write_report_and_warnings(validation_stats, EXPECTED_START_ID, VALIDATION_END_ID)
        print_summary(validation_report)
        return 1

    if args.validation_only:
        write_report_and_warnings(validation_stats, EXPECTED_START_ID, VALIDATION_END_ID)
        print_summary(validation_report)
        return 0

    final_stats = process_questions(EXPECTED_START_ID, EXPECTED_END_ID, FINAL_OUTPUT_PATH)
    final_report = write_report_and_warnings(final_stats, EXPECTED_START_ID, EXPECTED_END_ID)
    print_summary(final_report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
