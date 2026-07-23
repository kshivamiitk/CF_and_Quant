#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
ROADMAP_PATH = DATA / "roadmap.json"
PROGRESS_PATH = DATA / "progress.json"
CONTEST_CACHE_PATH = DATA / "contest_cache.json"
QUANT_BANK_PATH = DATA / "quant_questions.json"
QUANT_PROGRESS_PATH = DATA / "quant_progress.json"
PERSONAL_PATH = DATA / "personal.json"
CONTEST_CACHE_TTL_SECONDS = 10 * 60
CONTEST_LOOKAHEAD_DAYS = 45
OWNER_NAME = "Kumar Shivam"


def read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=True)
        file.write("\n")
    os.replace(tmp, path)


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def isoformat_utc(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_datetime(value) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(value, dt.timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = dt.datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    return None


def fetch_json_url(url: str, timeout: int = 60):
    request = Request(url, headers={"User-Agent": "cf2000-tracker/1.0"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def default_progress():
    return {
        "version": 1,
        "goal": {
            "currentRating": 1700,
            "targetRating": 2000,
            "deadline": "2026-12-31"
        },
        "profile": {
            "codeforcesHandle": ""
        },
        "lastSyncAt": None,
        "items": {}
    }


def default_quant_progress():
    return {
        "version": 1,
        "owner": OWNER_NAME,
        "activeQuestionId": None,
        "items": {},
        "history": []
    }


def default_personal():
    return {
        "version": 1,
        "owner": OWNER_NAME,
        "schedule": [],
        "notes": [],
        "updatedAt": None
    }


def flatten_nodes(nodes):
    for node in nodes:
        yield node
        yield from flatten_nodes(node.get("children", []))


def roadmap_items():
    roadmap = read_json(ROADMAP_PATH, {"topics": []})
    items = []
    for topic in roadmap.get("topics", []):
        for node in flatten_nodes(topic.get("nodes", [])):
            items.append(node)
    return items


def fetch_codeforces_status(handle: str):
    encoded = quote(handle)
    url = f"https://codeforces.com/api/user.status?handle={encoded}&from=1&count=100000"
    payload = fetch_json_url(url)
    if payload.get("status") != "OK":
        raise RuntimeError(payload.get("comment", "Codeforces API returned non-OK status"))
    return payload.get("result", [])


def sync_progress_from_codeforces(handle: str):
    progress = read_json(PROGRESS_PATH, default_progress())
    progress.setdefault("goal", default_progress()["goal"])
    progress.setdefault("profile", {})
    progress.setdefault("items", {})

    submissions = fetch_codeforces_status(handle)
    watched = {
        (item.get("contestId"), item.get("index")): item
        for item in roadmap_items()
        if item.get("contestId") is not None and item.get("index") is not None
    }
    summary = {
        key: {
            "id": item["id"],
            "attempts": 0,
            "accepted": False,
            "latestSubmissionTime": None,
            "acceptedSubmissionTime": None,
        }
        for key, item in watched.items()
    }
    watched_ids = {entry["id"] for entry in summary.values()}

    for submission in submissions:
        problem = submission.get("problem", {})
        key = (problem.get("contestId"), problem.get("index"))
        if key not in summary:
            continue
        entry = summary[key]
        entry["attempts"] += 1
        created = submission.get("creationTimeSeconds")
        if created and (entry["latestSubmissionTime"] is None or created > entry["latestSubmissionTime"]):
            entry["latestSubmissionTime"] = created
        if submission.get("verdict") == "OK":
            entry["accepted"] = True
            if created and (entry["acceptedSubmissionTime"] is None or created > entry["acceptedSubmissionTime"]):
                entry["acceptedSubmissionTime"] = created

    changed = 0
    cleared = 0
    matched = 0
    accepted = 0
    attempted = 0

    for item_id in watched_ids:
        item = progress["items"].get(item_id)
        if not item or item.get("statusSource") != "codeforces":
            continue
        old_status = item.get("status", "todo")
        item["status"] = "todo"
        item["attempts"] = 0
        item.pop("acceptedAt", None)
        item.pop("cfAttempts", None)
        item.pop("lastCfSubmissionAt", None)
        item.pop("statusSource", None)
        item["lastUpdated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        cleared += 1
        if old_status != "todo":
            changed += 1

    for entry in summary.values():
        if entry["attempts"] == 0:
            continue
        matched += 1
        item = progress["items"].setdefault(entry["id"], {
            "status": "todo",
            "comments": "",
            "learnings": "",
            "mistakes": "",
            "nextAction": "",
            "attempts": 0,
            "lastUpdated": None
        })
        old_status = item.get("status", "todo")
        if entry["accepted"]:
            accepted += 1
            item["status"] = "done"
            item["acceptedAt"] = entry["acceptedSubmissionTime"]
        elif old_status != "done":
            attempted += 1
            item["status"] = "doing"
        item["attempts"] = max(int(item.get("attempts") or 0), entry["attempts"])
        item["cfAttempts"] = entry["attempts"]
        item["lastCfSubmissionAt"] = entry["latestSubmissionTime"]
        item["statusSource"] = "codeforces"
        item["lastUpdated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        if item.get("status") != old_status:
            changed += 1

    progress["profile"]["codeforcesHandle"] = handle
    progress["lastSyncAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    progress["version"] = 1
    write_json(PROGRESS_PATH, progress)
    return {
        "ok": True,
        "handle": handle,
        "fetchedSubmissions": len(submissions),
        "matchedProblems": matched,
        "acceptedProblems": accepted,
        "attemptedWithoutAccepted": attempted,
        "clearedCodeforcesStatuses": cleared,
        "statusChanged": changed,
        "progress": progress,
    }


def contest_status(start: dt.datetime, end: dt.datetime, now: dt.datetime) -> str:
    if start <= now < end:
        return "live"
    if start > now:
        return "upcoming"
    return "past"


def contest_urgency(start: dt.datetime, end: dt.datetime, now: dt.datetime) -> str:
    if start <= now < end:
        return "live"
    seconds = int((start - now).total_seconds())
    if seconds <= 6 * 3600:
        return "critical"
    if seconds <= 24 * 3600:
        return "soon"
    if seconds <= 7 * 24 * 3600:
        return "week"
    return "later"


def calendar_url(title: str, start: dt.datetime, end: dt.datetime, url: str) -> str:
    dates = f"{start.strftime('%Y%m%dT%H%M%SZ')}/{end.strftime('%Y%m%dT%H%M%SZ')}"
    query = urlencode({
        "action": "TEMPLATE",
        "text": title,
        "dates": dates,
        "details": url,
        "location": url,
    })
    return f"https://calendar.google.com/calendar/render?{query}"


def normalize_contest(
    platform: str,
    raw_id: str,
    title: str,
    url: str,
    start: dt.datetime,
    end: dt.datetime,
    now: dt.datetime,
):
    start = start.astimezone(dt.timezone.utc)
    end = end.astimezone(dt.timezone.utc)
    return {
        "id": f"{platform.lower()}-{raw_id}",
        "platform": platform,
        "title": title,
        "url": url,
        "startTime": isoformat_utc(start),
        "startTimeSeconds": int(start.timestamp()),
        "endTime": isoformat_utc(end),
        "endTimeSeconds": int(end.timestamp()),
        "durationSeconds": max(0, int((end - start).total_seconds())),
        "status": contest_status(start, end, now),
        "urgency": contest_urgency(start, end, now),
        "startsInSeconds": int((start - now).total_seconds()),
        "endsInSeconds": int((end - now).total_seconds()),
        "calendarUrl": calendar_url(f"{platform}: {title}", start, end, url),
    }


def upcoming_codeforces_contests(now: dt.datetime) -> list[dict]:
    payload = fetch_json_url("https://codeforces.com/api/contest.list?gym=false")
    if payload.get("status") != "OK":
        raise RuntimeError(payload.get("comment", "Codeforces contest.list returned non-OK status"))

    contests = []
    lookahead_end = now + dt.timedelta(days=CONTEST_LOOKAHEAD_DAYS)
    for contest in payload.get("result", []):
        start_seconds = contest.get("startTimeSeconds")
        duration_seconds = int(contest.get("durationSeconds") or 0)
        if not start_seconds or duration_seconds <= 0:
            continue
        start = dt.datetime.fromtimestamp(start_seconds, dt.timezone.utc)
        end = start + dt.timedelta(seconds=duration_seconds)
        if end < now or start > lookahead_end:
            continue
        phase = contest.get("phase")
        if phase not in {"BEFORE", "CODING"}:
            continue
        contest_id = str(contest.get("id"))
        contests.append(normalize_contest(
            "Codeforces",
            contest_id,
            contest.get("name", f"Contest {contest_id}"),
            f"https://codeforces.com/contest/{contest_id}",
            start,
            end,
            now,
        ))
    return contests


def upcoming_codechef_contests(now: dt.datetime) -> list[dict]:
    payload = fetch_json_url("https://contest-hive.vercel.app/api/codechef")
    data = payload.get("data", payload if isinstance(payload, list) else [])
    if not isinstance(data, list):
        raise RuntimeError("CodeChef contest feed returned an unexpected shape")

    contests = []
    lookahead_end = now + dt.timedelta(days=CONTEST_LOOKAHEAD_DAYS)
    for index, contest in enumerate(data):
        if not isinstance(contest, dict):
            continue
        title = contest.get("title") or contest.get("name") or contest.get("contestName")
        url = contest.get("url") or contest.get("href") or "https://www.codechef.com/contests"
        start = parse_datetime(contest.get("startTime") or contest.get("start") or contest.get("start_date"))
        end = parse_datetime(contest.get("endTime") or contest.get("end") or contest.get("end_date"))
        if not start:
            continue
        if not end:
            duration = int(contest.get("duration") or contest.get("durationSeconds") or 0)
            end = start + dt.timedelta(seconds=duration if duration > 0 else 2 * 3600)
        if end < now or start > lookahead_end:
            continue
        raw_id = str(contest.get("id") or contest.get("code") or contest.get("contestCode") or f"{int(start.timestamp())}-{index}")
        contests.append(normalize_contest(
            "CodeChef",
            raw_id,
            title or "CodeChef Contest",
            url,
            start,
            end,
            now,
        ))
    return contests




IST = dt.timezone(dt.timedelta(hours=5, minutes=30), name="IST")
DESKTOP_TARGET_MINIMUM = 3
DESKTOP_TARGET_MAXIMUM = 6


def roadmap_items_with_context():
    roadmap = read_json(ROADMAP_PATH, {"topics": []})
    items = []

    def visit(node: dict, topic: dict, parent_id: str | None, depth: int) -> None:
        item = dict(node)
        item.pop("children", None)
        item["topicId"] = topic.get("id", "topic")
        item["topicTitle"] = topic.get("title", "Roadmap")
        item["parentId"] = parent_id
        item["depth"] = depth
        items.append(item)
        for child in node.get("children", []) or []:
            visit(child, topic, node.get("id"), depth + 1)

    for topic in roadmap.get("topics", []):
        for node in topic.get("nodes", []) or []:
            visit(node, topic, None, 0)
    return items


def progress_item(progress: dict, item_id: str) -> dict:
    return (progress.get("items") or {}).get(item_id, {})


def progress_status(progress: dict, item_id: str) -> str:
    return progress_item(progress, item_id).get("status") or "todo"


def is_item_done(progress: dict, item_id: str | None) -> bool:
    return bool(item_id) and progress_status(progress, item_id) == "done"


def is_item_unlocked(progress: dict, item: dict) -> bool:
    parent_id = item.get("parentId")
    return not parent_id or is_item_done(progress, parent_id)


def item_time_value(value) -> dt.datetime | None:
    parsed = parse_datetime(value)
    if parsed:
        return parsed
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(value, dt.timezone.utc)
    return None


def item_done_today(progress: dict, item_id: str, today_ist: dt.date) -> bool:
    item = progress_item(progress, item_id)
    if progress_status(progress, item_id) != "done":
        return False
    for key in ("acceptedAt", "lastUpdated"):
        when = item_time_value(item.get(key))
        if when and when.astimezone(IST).date() == today_ist:
            return True
    return False


def compact_problem(item: dict, progress: dict | None = None) -> dict:
    progress = progress or {}
    return {
        "id": item.get("id"),
        "title": item.get("title") or item.get("problemName") or "Problem",
        "problemName": item.get("problemName"),
        "topicTitle": item.get("topicTitle"),
        "rating": item.get("rating"),
        "url": item.get("url"),
        "tags": item.get("tags") or [],
        "focus": item.get("focus") or "Keep pushing the roadmap forward.",
        "status": progress_status(progress, item.get("id")),
        "attempts": int(progress_item(progress, item.get("id")).get("attempts") or 0),
        "nextAction": progress_item(progress, item.get("id")).get("nextAction") or "Solve, upsolve, then write one mistake note.",
    }


def build_today_payload() -> dict:
    now = utc_now()
    today_ist = now.astimezone(IST).date()
    progress = read_json(PROGRESS_PATH, default_progress())
    items = roadmap_items_with_context()
    total = len(items)
    done_items = [item for item in items if progress_status(progress, item.get("id")) == "done"]
    doing_items = [item for item in items if progress_status(progress, item.get("id")) == "doing"]
    unlocked_todo = [
        item for item in items
        if progress_status(progress, item.get("id")) == "todo" and is_item_unlocked(progress, item)
    ]
    locked = max(0, total - len(done_items) - len(doing_items) - len(unlocked_todo))

    deadline = parse_datetime(progress.get("goal", {}).get("deadline"))
    if deadline is None:
        try:
            raw = progress.get("goal", {}).get("deadline") or "2026-12-31"
            year, month, day = [int(part) for part in str(raw).split("-")[:3]]
            deadline = dt.datetime(year, month, day, 23, 59, tzinfo=IST).astimezone(dt.timezone.utc)
        except Exception:
            deadline = dt.datetime(2026, 12, 31, 23, 59, tzinfo=IST).astimezone(dt.timezone.utc)
    days_left = max(1, (deadline.astimezone(IST).date() - today_ist).days + 1)
    remaining = max(0, total - len(done_items))
    pace_needed = max(DESKTOP_TARGET_MINIMUM, min(DESKTOP_TARGET_MAXIMUM, (remaining + days_left - 1) // days_left))
    target_pool = doing_items[:1] if doing_items else unlocked_todo[:1]
    targets = [compact_problem(item, progress) for item in target_pool]
    solved_today = [compact_problem(item, progress) for item in items if item_done_today(progress, item.get("id"), today_ist)]

    try:
        contest_data = contests_payload(False)
    except Exception as exc:
        contest_data = {"ok": False, "error": str(exc), "contests": []}
    now_seconds = int(now.timestamp())
    contests = [contest for contest in contest_data.get("contests", []) if contest.get("endTimeSeconds", 0) > now_seconds]
    contests.sort(key=lambda contest: (contest.get("startTimeSeconds", 0), contest.get("platform", "")))
    urgent_contests = [
        contest for contest in contests
        if contest.get("startTimeSeconds", 0) <= now_seconds + 7 * 24 * 3600 or contest.get("status") == "live"
    ][:5]

    pct = round((len(done_items) / total) * 100, 1) if total else 0
    profile = progress.get("profile", {}) or {}
    goal = progress.get("goal", {}) or default_progress()["goal"]
    return {
        "ok": True,
        "generatedAt": isoformat_utc(now),
        "todayDate": today_ist.isoformat(),
        "timezone": "Asia/Kolkata",
        "headline": f"Today's CF 2000 sprint: {len(targets)} target{'s' if len(targets) != 1 else ''}",
        "motivation": "One clean solve, one honest upsolve, one mistake note. That is how 2000 happens.",
        "profile": profile,
        "goal": goal,
        "stats": {
            "total": total,
            "done": len(done_items),
            "doing": len(doing_items),
            "unlockedTodo": len(unlocked_todo),
            "locked": locked,
            "remaining": remaining,
            "progressPercent": pct,
            "daysLeft": days_left,
            "dailyNeeded": 1 if targets else 0,
            "paceNeeded": pace_needed,
            "solvedToday": len(solved_today),
        },
        "targets": targets,
        "solvedToday": solved_today[:8],
        "contests": urgent_contests,
        "contestSource": {
            "ok": contest_data.get("ok", False),
            "cached": contest_data.get("cached", False),
            "stale": contest_data.get("stale", False),
            "generatedAt": contest_data.get("generatedAt"),
            "sourceErrors": contest_data.get("sourceErrors", []),
        },
    }


def refresh_contests() -> dict:
    now = utc_now()
    contests: list[dict] = []
    source_errors = []

    for platform, fetcher in (
        ("Codeforces", upcoming_codeforces_contests),
        ("CodeChef", upcoming_codechef_contests),
    ):
        try:
            contests.extend(fetcher(now))
        except Exception as exc:
            source_errors.append({"platform": platform, "error": str(exc)})

    contests.sort(key=lambda item: (item["startTimeSeconds"], item["platform"], item["title"]))
    payload = {
        "ok": not source_errors or bool(contests),
        "generatedAt": isoformat_utc(now),
        "cacheTtlSeconds": CONTEST_CACHE_TTL_SECONDS,
        "lookaheadDays": CONTEST_LOOKAHEAD_DAYS,
        "cached": False,
        "stale": False,
        "sourceErrors": source_errors,
        "contestCount": len(contests),
        "contests": contests,
    }

    if contests:
        write_json(CONTEST_CACHE_PATH, payload)
    elif CONTEST_CACHE_PATH.exists():
        cached = read_json(CONTEST_CACHE_PATH, {})
        cached["cached"] = True
        cached["stale"] = True
        cached["sourceErrors"] = source_errors
        return cached
    return payload


def contests_payload(force_refresh: bool = False) -> dict:
    if not force_refresh and CONTEST_CACHE_PATH.exists():
        cached = read_json(CONTEST_CACHE_PATH, {})
        generated_at = parse_datetime(cached.get("generatedAt"))
        if generated_at and (utc_now() - generated_at).total_seconds() < CONTEST_CACHE_TTL_SECONDS:
            cached["cached"] = True
            cached["stale"] = False
            return cached
    return refresh_contests()


def quant_bank() -> dict:
    return read_json(QUANT_BANK_PATH, {
        "version": 1,
        "owner": OWNER_NAME,
        "sources": [],
        "questionCount": 0,
        "questions": []
    })


def quant_progress() -> dict:
    progress = read_json(QUANT_PROGRESS_PATH, default_quant_progress())
    progress.setdefault("version", 1)
    progress.setdefault("owner", OWNER_NAME)
    progress.setdefault("activeQuestionId", None)
    progress.setdefault("items", {})
    progress.setdefault("history", [])
    return progress


def quant_status(progress: dict, question_id: str) -> str:
    return (progress.get("items") or {}).get(question_id, {}).get("status") or "todo"


def public_quant_question(question: dict, progress: dict | None = None, include_solution: bool = False) -> dict:
    item = (progress or {}).get("items", {}).get(question.get("id"), {})
    payload = {
        "id": question.get("id"),
        "sourceId": question.get("sourceId"),
        "sourceTitle": question.get("sourceTitle"),
        "number": question.get("number"),
        "title": question.get("title"),
        "topic": question.get("topic"),
        "difficulty": question.get("difficulty"),
        "prompt": question.get("prompt"),
        "tags": question.get("tags") or [],
        "status": item.get("status") or "todo",
        "attempts": int(item.get("attempts") or 0),
        "assignedAt": item.get("assignedAt"),
        "solvedAt": item.get("solvedAt"),
        "userSolution": item.get("userSolution") or "",
        "notes": item.get("notes") or "",
        "solutionRevealed": bool(item.get("solutionRevealed")),
    }
    if include_solution:
        payload["solution"] = question.get("solution") or ""
    return payload


def quant_stats(bank: dict, progress: dict) -> dict:
    questions = bank.get("questions") or []
    done = sum(1 for question in questions if quant_status(progress, question.get("id")) == "done")
    doing = sum(1 for question in questions if quant_status(progress, question.get("id")) == "doing")
    by_topic: dict[str, dict] = {}
    for question in questions:
        topic = question.get("topic") or "general"
        entry = by_topic.setdefault(topic, {"topic": topic, "total": 0, "done": 0})
        entry["total"] += 1
        if quant_status(progress, question.get("id")) == "done":
            entry["done"] += 1
    return {
        "total": len(questions),
        "done": done,
        "doing": doing,
        "remaining": max(0, len(questions) - done),
        "progressPercent": round((done / len(questions)) * 100, 1) if questions else 0,
        "byTopic": sorted(by_topic.values(), key=lambda entry: (-entry["total"], entry["topic"]))[:12],
    }


def build_quant_list_payload() -> dict:
    bank = quant_bank()
    progress = quant_progress()
    return {
        "ok": True,
        "owner": OWNER_NAME,
        "sources": bank.get("sources") or [],
        "questionCount": len(bank.get("questions") or []),
        "stats": quant_stats(bank, progress),
        "questions": [
            public_quant_question(question, progress, include_solution=False)
            for question in bank.get("questions", [])
        ],
    }


def build_quant_today_payload(assign_next: bool = True) -> dict:
    bank = quant_bank()
    questions = bank.get("questions") or []
    progress = quant_progress()
    question_by_id = {question.get("id"): question for question in questions}
    active_id = progress.get("activeQuestionId")
    active_item = (progress.get("items") or {}).get(active_id, {}) if active_id else {}
    changed = False

    if active_id and active_item.get("status") != "done" and active_id in question_by_id:
        current_id = active_id
    else:
        current_id = None
        if assign_next:
            for question in questions:
                question_id = question.get("id")
                if quant_status(progress, question_id) != "done":
                    current_id = question_id
                    break
            progress["activeQuestionId"] = current_id
            changed = True

    if current_id:
        item = progress["items"].setdefault(current_id, {})
        if item.get("status") in (None, "", "todo"):
            item["status"] = "doing"
            item["assignedAt"] = isoformat_utc(utc_now())
            item["lastUpdated"] = item["assignedAt"]
            changed = True
        include_solution = item.get("status") == "done" or bool(item.get("solutionRevealed"))
        current = public_quant_question(question_by_id[current_id], progress, include_solution=include_solution)
    else:
        current = None

    if changed:
        write_json(QUANT_PROGRESS_PATH, progress)

    return {
        "ok": True,
        "owner": OWNER_NAME,
        "generatedAt": isoformat_utc(utc_now()),
        "current": current,
        "activeQuestionId": current_id,
        "stats": quant_stats(bank, progress),
        "lockedReason": "Finish the active problem before a new daily problem is assigned." if current else None,
    }


def update_quant_question(payload: dict) -> dict:
    question_id = str(payload.get("id", "")).strip()
    if not question_id:
        raise ValueError("Question id is required")

    bank = quant_bank()
    question_by_id = {question.get("id"): question for question in bank.get("questions", [])}
    if question_id not in question_by_id:
        raise ValueError("Unknown question id")

    progress = quant_progress()
    item = progress["items"].setdefault(question_id, {})
    now = isoformat_utc(utc_now())
    status = payload.get("status")
    if status is not None:
        status = str(status)
        if status not in {"todo", "doing", "done"}:
            raise ValueError("Status must be todo, doing, or done")
        item["status"] = status
        if status == "done":
            item["solvedAt"] = item.get("solvedAt") or now
            item["solutionRevealed"] = True
            progress["activeQuestionId"] = None
            progress["history"].append({"id": question_id, "solvedAt": item["solvedAt"]})
        elif progress.get("activeQuestionId") in {None, question_id}:
            progress["activeQuestionId"] = question_id
    if "attempts" in payload:
        item["attempts"] = max(0, int(payload.get("attempts") or 0))
    if "userSolution" in payload:
        item["userSolution"] = str(payload.get("userSolution") or "")
    if "notes" in payload:
        item["notes"] = str(payload.get("notes") or "")
    if "solutionRevealed" in payload:
        item["solutionRevealed"] = bool(payload.get("solutionRevealed"))
    item["lastUpdated"] = now
    write_json(QUANT_PROGRESS_PATH, progress)
    include_solution = item.get("status") == "done" or bool(item.get("solutionRevealed"))
    return {
        "ok": True,
        "question": public_quant_question(question_by_id[question_id], progress, include_solution=include_solution),
        "today": build_quant_today_payload(assign_next=False),
    }


class TrackerHandler(BaseHTTPRequestHandler):
    server_version = "CF2000Tracker/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def private_token(self) -> str:
        return getattr(self.server, "private_token", "") or ""

    def is_authorized(self) -> bool:
        expected = self.private_token()
        if not expected:
            return True
        parsed = urlparse(self.path)
        query_parts = parse_qs(parsed.query)
        supplied = self.headers.get("X-Tracker-Token") or (query_parts.get("token") or [""])[0]
        return supplied == expected

    def require_api_auth(self) -> bool:
        if self.is_authorized():
            return True
        self.send_json({"error": "Private token required"}, 401)
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/") and not self.require_api_auth():
            return

        if path == "/api/roadmap":
            return self.send_json(read_json(ROADMAP_PATH, {"topics": []}))
        if path == "/api/progress":
            return self.send_json(read_json(PROGRESS_PATH, default_progress()))
        if path == "/api/quant":
            return self.send_json(build_quant_list_payload())
        if path == "/api/quant/today":
            return self.send_json(build_quant_today_payload())
        if path == "/api/personal":
            return self.send_json(read_json(PERSONAL_PATH, default_personal()))
        if path == "/api/contests":
            query = urlparse(self.path).query
            force_refresh = "refresh=1" in query
            try:
                return self.send_json(contests_payload(force_refresh))
            except Exception as exc:
                return self.send_json({"ok": False, "error": str(exc), "contests": []}, 502)
        if path == "/api/today":
            try:
                return self.send_json(build_today_payload())
            except Exception as exc:
                return self.send_json({"ok": False, "error": str(exc), "targets": [], "contests": []}, 502)
        if path == "/health":
            return self.send_text("ok\n")
        if path == "/":
            return self.serve_file(PUBLIC / "index.html")

        requested = unquote(path.lstrip("/"))
        safe_path = (PUBLIC / requested).resolve()
        if PUBLIC.resolve() not in safe_path.parents and safe_path != PUBLIC.resolve():
            return self.send_text("Forbidden\n", 403)
        return self.serve_file(safe_path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/progress", "/api/sync-codeforces", "/api/quant/progress", "/api/personal"}:
            return self.send_text("Not found\n", 404)
        if not self.require_api_auth():
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return self.send_json({"error": "Invalid JSON"}, 400)

        if parsed.path == "/api/sync-codeforces":
            handle = str(payload.get("handle", "")).strip()
            if not handle:
                return self.send_json({"error": "Codeforces handle is required"}, 400)
            try:
                return self.send_json(sync_progress_from_codeforces(handle))
            except HTTPError as exc:
                return self.send_json({"error": f"Codeforces HTTP error {exc.code}"}, 502)
            except URLError as exc:
                return self.send_json({"error": f"Could not reach Codeforces: {exc.reason}"}, 502)
            except Exception as exc:
                return self.send_json({"error": str(exc)}, 502)

        if parsed.path == "/api/quant/progress":
            try:
                return self.send_json(update_quant_question(payload))
            except ValueError as exc:
                return self.send_json({"error": str(exc)}, 400)
            except Exception as exc:
                return self.send_json({"error": str(exc)}, 500)

        if parsed.path == "/api/personal":
            existing = read_json(PERSONAL_PATH, default_personal())
            if not isinstance(payload, dict):
                return self.send_json({"error": "Personal payload must be an object"}, 400)
            existing["owner"] = OWNER_NAME
            existing["schedule"] = payload.get("schedule", existing.get("schedule", []))
            existing["notes"] = payload.get("notes", existing.get("notes", []))
            existing["updatedAt"] = isoformat_utc(utc_now())
            existing["version"] = 1
            write_json(PERSONAL_PATH, existing)
            return self.send_json({"ok": True, "personal": existing})

        if not isinstance(payload, dict) or "items" not in payload:
            return self.send_json({"error": "Progress payload must contain items"}, 400)

        existing = read_json(PROGRESS_PATH, default_progress())
        existing["goal"] = payload.get("goal", existing.get("goal", default_progress()["goal"]))
        existing["profile"] = payload.get("profile", existing.get("profile", default_progress()["profile"]))
        existing["lastSyncAt"] = payload.get("lastSyncAt", existing.get("lastSyncAt"))
        existing["items"] = payload.get("items", {})
        existing["version"] = 1
        write_json(PROGRESS_PATH, existing)
        return self.send_json({"ok": True, "progress": existing})

    def serve_file(self, path: Path):
        if not path.exists() or not path.is_file():
            return self.send_text("Not found\n", 404)
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Local Codeforces 2000 rating tracker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=os.environ.get("CF2000_PRIVATE_TOKEN", ""))
    args = parser.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    if not PROGRESS_PATH.exists():
        write_json(PROGRESS_PATH, default_progress())
    if not QUANT_PROGRESS_PATH.exists():
        write_json(QUANT_PROGRESS_PATH, default_quant_progress())
    if not PERSONAL_PATH.exists():
        write_json(PERSONAL_PATH, default_personal())

    server = ThreadingHTTPServer((args.host, args.port), TrackerHandler)
    server.private_token = args.token
    print(f"CF 2000 Tracker running at http://{args.host}:{args.port}")
    if args.token:
        print("Private API token is enabled. Open with ?token=YOUR_TOKEN once on each device.")
    elif args.host not in {"127.0.0.1", "localhost"}:
        print("Warning: running on a network host without --token exposes tracker APIs to the network.")
    server.serve_forever()


if __name__ == "__main__":
    main()
