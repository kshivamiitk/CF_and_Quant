#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BANK_PATH = ROOT / "data" / "quant_questions.json"
OUTPUT_DIR = ROOT / "public" / "quant-solutions"
GUIDE_PATH = Path("/Users/kumarshivam/Downloads/QUANT GUIDE.pdf")
GREEN_PATH = Path("/Users/kumarshivam/Downloads/green-book-few pages.pdf")
RENDER_SCALE = 1.65


@dataclass(frozen=True, order=True)
class Position:
    page: int
    y: float


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def page_blocks(document: pymupdf.Document, page_number: int) -> list[tuple]:
    return sorted(document[page_number].get_text("blocks"), key=lambda block: (block[1], block[0]))


def guide_solution_positions(document: pymupdf.Document) -> dict[int, Position]:
    positions: dict[int, Position] = {}
    pattern = re.compile(r"Solution\s+to\s+Question\s+(\d+):", re.I)
    for page_number in range(248, len(document)):
        for block in page_blocks(document, page_number):
            match = pattern.search(block[4])
            if match:
                positions[int(match.group(1))] = Position(page_number, float(block[1]))
    return positions


def green_title_positions(document: pymupdf.Document, questions: list[dict]) -> dict[str, Position]:
    blocks: list[tuple[Position, str]] = []
    for page_number in range(14, len(document)):
        for block in page_blocks(document, page_number):
            blocks.append((Position(page_number, float(block[1])), normalized(block[4])))

    positions: dict[str, Position] = {}
    cursor = Position(14, 0)
    for question in questions:
        title = normalized(question["title"]).rstrip(".")
        match = next(
            (
                position
                for position, text in blocks
                if position > cursor and (text.startswith(title) or title in text[: len(title) + 8])
            ),
            None,
        )
        if match is None:
            raise RuntimeError(f"Could not locate Green Book title: {question['title']}")
        positions[question["id"]] = match
        cursor = match
    return positions


def green_solution_positions(document: pymupdf.Document) -> list[Position]:
    positions: list[Position] = []
    pattern = re.compile(r"\bSolution\s*:", re.I)
    for page_number in range(14, len(document)):
        page = document[page_number]
        for block in page_blocks(document, page_number):
            if not pattern.search(block[4]):
                continue
            rects = page.search_for("Solution:")
            rect = next((rect for rect in rects if abs(rect.y0 - block[1]) < 12), None)
            positions.append(Position(page_number, float(rect.y0 if rect else block[1])))
    return sorted(set(positions))


def render_solution(
    document: pymupdf.Document,
    start: Position,
    end: Position | None,
    output_stem: Path,
    horizontal_margin: float,
    continuation_top: float,
) -> list[str]:
    output_paths: list[str] = []
    final_page = end.page if end else len(document) - 1
    for page_number in range(start.page, final_page + 1):
        page = document[page_number]
        top = max(0, start.y - 7) if page_number == start.page else continuation_top
        bottom = (
            max(top + 12, end.y - 8)
            if end and page_number == end.page
            else page.rect.height - 52
        )
        if bottom - top < 16:
            continue
        clip = pymupdf.Rect(horizontal_margin, top, page.rect.width - horizontal_margin, bottom)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(RENDER_SCALE, RENDER_SCALE), clip=clip, alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        file_path = output_stem.with_name(f"{output_stem.name}-{len(output_paths) + 1}.webp")
        image.save(file_path, "WEBP", quality=88, method=6)
        output_paths.append(f"/quant-solutions/{file_path.name}")
    return output_paths


def build_guide_images(questions: list[dict]) -> None:
    document = pymupdf.open(GUIDE_PATH)
    positions = guide_solution_positions(document)
    if len(positions) != len(questions):
        raise RuntimeError(f"Expected {len(questions)} Guide solutions, found {len(positions)}")

    ordered = sorted(positions.items())
    for index, question in enumerate(questions):
        number = int(question["number"])
        start = positions[number]
        end = positions.get(number + 1)
        question["solutionImages"] = render_solution(
            document,
            start,
            end,
            OUTPUT_DIR / question["id"],
            horizontal_margin=92,
            continuation_top=118,
        )
        question.pop("solution", None)
        if (index + 1) % 100 == 0:
            print(f"Rendered {index + 1}/{len(questions)} Quant Guide solutions")


def build_green_images(questions: list[dict]) -> None:
    document = pymupdf.open(GREEN_PATH)
    titles = green_title_positions(document, questions)
    solution_markers = green_solution_positions(document)

    for index, question in enumerate(questions):
        title_start = titles[question["id"]]
        next_title = (
            titles[questions[index + 1]["id"]]
            if index + 1 < len(questions)
            else Position(title_start.page, document[title_start.page].rect.height - 42)
        )
        start = next(
            (
                marker
                for marker in solution_markers
                if marker > title_start and marker < next_title
            ),
            None,
        )
        if start is None:
            raise RuntimeError(f"Could not locate Green Book solution: {question['title']}")
        question["solutionImages"] = render_solution(
            document,
            start,
            next_title,
            OUTPUT_DIR / question["id"],
            horizontal_margin=4,
            continuation_top=42,
        )
        question.pop("solution", None)


def main() -> None:
    if not GUIDE_PATH.exists() or not GREEN_PATH.exists():
        raise SystemExit("Source PDFs are missing from Downloads.")

    bank = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    questions = bank.get("questions") or []
    guide_questions = [question for question in questions if question.get("sourceId") == "quant-guide"]
    green_questions = [question for question in questions if question.get("sourceId") == "green-book"]

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    build_guide_images(guide_questions)
    build_green_images(green_questions)
    bank["solutionFormat"] = "webp-crops"
    bank["version"] = max(2, int(bank.get("version") or 1))
    temporary = BANK_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(bank, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    temporary.replace(BANK_PATH)
    print(f"Created solution images for {len(questions)} questions in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
