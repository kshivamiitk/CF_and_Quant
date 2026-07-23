#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "quant_questions.json"
PDFS = [
    Path("/Users/kumarshivam/Downloads/QUANT GUIDE.pdf"),
    Path("/Users/kumarshivam/Downloads/QUANT GUIDE 2.pdf"),
    Path("/Users/kumarshivam/Downloads/green-book-few pages.pdf"),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def pdf_text(path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout


def normalize_text(value: str) -> str:
    replacements = {
        "\x0c": "\n",
        "”": '"',
        "“": '"',
        "’": "'",
        "‘": "'",
        "−": "-",
        "×": "x",
        "∆": "Delta",
        "∼": "~",
        "≥": ">=",
        "≤": "<=",
        "∞": "infinity",
        "π": "pi",
        "Φ": "Phi",
        "â": "'",
        "Â": "^",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    lines = []
    skip_exact = {
        "CHAPTER 1. QUESTIONS",
        "CHAPTER 2. SOLUTIONS",
        "CONTENTS",
        "Contents",
    }
    for raw in value.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        if stripped in skip_exact:
            continue
        if re.fullmatch(r"\d+", stripped):
            continue
        if re.fullmatch(r"\d+\s+CHAPTER \d+\..*", stripped):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def compact(value: str) -> str:
    value = normalize_text(value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def clean_topic(value: str) -> str:
    raw = re.sub(r"[^a-zA-Z ]+", " ", value.lower())
    raw = re.sub(r"\s+", " ", raw).strip()
    known = [
        "probability",
        "brainteasers",
        "finance",
        "statistics",
        "pure math",
        "calculus",
        "linear algebra",
        "general",
    ]
    for topic in known:
        if topic in raw:
            return topic
    if "brain" in raw:
        return "brainteasers"
    if "math" in raw:
        return "pure math"
    return raw or "general"


def clean_difficulty(value: str) -> str:
    raw = re.sub(r"[^a-zA-Z]+", " ", value.lower())
    for difficulty in ("easy", "medium", "hard"):
        if difficulty in raw:
            return difficulty
    return "unknown"


def parse_quant_guide(path: Path, source_index: int) -> list[dict]:
    text = normalize_text(pdf_text(path))
    solutions_start = text.find("Solutions\n\nSolution to Question 1:")
    if solutions_start == -1:
        raise RuntimeError(f"Could not find solutions section in {path}")

    questions_text = text[:solutions_start]
    solutions_text = text[solutions_start:]
    question_matches = list(re.finditer(r"^Question (\d+):\s*(.+)$", questions_text, re.M))
    solution_matches = list(re.finditer(r"^Solution to Question (\d+):\s*(.+)$", solutions_text, re.M))

    solutions: dict[int, str] = {}
    for index, match in enumerate(solution_matches):
        start = match.end()
        end = solution_matches[index + 1].start() if index + 1 < len(solution_matches) else len(solutions_text)
        number = int(match.group(1))
        solutions[number] = compact(solutions_text[start:end])

    questions = []
    for index, match in enumerate(question_matches):
        start = match.end()
        end = question_matches[index + 1].start() if index + 1 < len(question_matches) else len(questions_text)
        number = int(match.group(1))
        title = match.group(2).strip()
        body = compact(questions_text[start:end])

        topic = "general"
        difficulty = "unknown"
        meta = re.match(r"Topic:\s*(.+?)\s+Difficulty:\s*(\w+)\s*(.*)$", body, re.S)
        if meta:
            topic = clean_topic(meta.group(1))
            difficulty = clean_difficulty(meta.group(2))
            body = compact(meta.group(3))

        questions.append({
            "id": f"quant-guide-q{number:04d}",
            "sourceId": "quant-guide",
            "sourceTitle": "Problems and Solutions Book",
            "sourceIndex": source_index,
            "number": number,
            "title": title,
            "topic": topic,
            "difficulty": difficulty,
            "prompt": body,
            "solution": solutions.get(number, ""),
            "tags": [topic, difficulty],
        })
    return questions


def green_toc_titles(text: str) -> list[str]:
    toc_start = text.find("Table of Contents")
    chapter1_matches = list(re.finditer("Chapter 1 General Principles", text))
    toc_end = chapter1_matches[1].start() if len(chapter1_matches) > 1 else -1
    if toc_start == -1 or toc_end == -1 or toc_end <= toc_start:
        return []
    titles = []
    for raw in text[toc_start:toc_end].splitlines():
        stripped = raw.strip().strip(".")
        if not stripped or stripped.startswith("Chapter") or re.match(r"^\d+(\.\d+)?\s", stripped):
            continue
        match = re.match(r"(.+?)\s+\.?\s*\d+\s*$", stripped)
        if not match:
            continue
        title = match.group(1).strip(" .")
        if len(title) < 3:
            continue
        if title.lower() in {"contents"}:
            continue
        titles.append(re.sub(r"\s+", " ", title))
    seen = set()
    unique = []
    for title in titles:
        key = title.lower()
        if key not in seen:
            seen.add(key)
            unique.append(title)
    return unique


def parse_green_book(path: Path, source_index: int) -> list[dict]:
    raw_text = pdf_text(path)
    titles = green_toc_titles(raw_text)
    text = normalize_text(raw_text)
    entries = []
    locations = []
    chapter2_matches = list(re.finditer(r"^Chapter 2 Brain Teasers$", text, re.M))
    body_start = chapter2_matches[-1].start() if chapter2_matches else 0

    for title in titles:
        pattern = re.compile(rf"^{re.escape(title)}\.?\s*$", re.M | re.I)
        matches = list(pattern.finditer(text))
        if not matches:
            continue
        body_match = next((m for m in matches if m.start() > body_start), matches[-1])
        locations.append((body_match.start(), title))

    locations.sort(key=lambda item: item[0])
    for index, (start, title) in enumerate(locations, start=1):
        end = locations[index][0] if index < len(locations) else len(text)
        block = text[start:end]
        first_newline = block.find("\n")
        if first_newline != -1:
            block = block[first_newline + 1:]
        if "Solution:" not in block:
            continue
        prompt, solution = block.split("Solution:", 1)
        prompt = compact(prompt)
        solution = compact(solution)
        if len(prompt) < 20 or len(solution) < 20:
            continue
        entries.append({
            "id": f"green-book-q{len(entries) + 1:03d}",
            "sourceId": "green-book",
            "sourceTitle": "A Practical Guide To Quantitative Finance Interviews",
            "sourceIndex": source_index,
            "number": len(entries) + 1,
            "title": title,
            "topic": "interview problem",
            "difficulty": "unknown",
            "prompt": prompt,
            "solution": solution,
            "tags": ["green book", "interview problem"],
        })
    return entries


def main() -> None:
    present = [path for path in PDFS if path.exists()]
    if not present:
        raise SystemExit("No source PDFs found.")

    sources = []
    seen_hashes = {}
    questions = []
    for source_index, path in enumerate(present, start=1):
        digest = sha256(path)
        duplicate_of = seen_hashes.get(digest)
        source = {
            "id": f"source-{source_index}",
            "fileName": path.name,
            "path": str(path),
            "sha256": digest,
            "duplicateOf": duplicate_of,
        }
        sources.append(source)
        if duplicate_of:
            continue
        seen_hashes[digest] = source["id"]
        if "QUANT GUIDE" in path.name:
            questions.extend(parse_quant_guide(path, source_index))
        elif "green-book" in path.name:
            questions.extend(parse_green_book(path, source_index))

    payload = {
        "version": 1,
        "owner": "Kumar Shivam",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sources": sources,
        "questionCount": len(questions),
        "questions": questions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    tmp.replace(OUT)
    print(f"Wrote {len(questions)} questions to {OUT}")


if __name__ == "__main__":
    main()
