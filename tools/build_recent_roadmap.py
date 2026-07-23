#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import gzip
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
ROADMAP_PATH = DATA / "roadmap.json"
CUTOFF = dt.datetime(2024, 7, 3, tzinfo=dt.timezone.utc)
BASE_RATINGS = (1600, 1700, 1800, 1900, 2000)
BASE_PER_RATING = 4
BONUS_RATINGS = (1900, 1900, 2000, 2000, 2000, 2100, 2100, 2100, 2200, 2200)
BASE_PROBLEMS_PER_TRACK = BASE_PER_RATING * len(BASE_RATINGS) + len(BONUS_RATINGS)
DRILL_RATINGS = (1700, 1800, 1900)
DRILL_TOTALS = {
    1700: 50,
    1800: 75,
    1900: 75,
}
PROBLEMS_PER_TRACK = 50
MIN_RATING = min(BASE_RATINGS)
MAX_RATING = max(BONUS_RATINGS)

TRACKS = [
    {
        "id": "combinatorics",
        "title": "Combinatorics and Counting",
        "goal": "Count cleanly, avoid overcounting, and combine counting with modular arithmetic.",
        "tags": {"combinatorics"},
    },
    {
        "id": "bitmasks-games-strings",
        "title": "Bitmasks, Games, and Strings",
        "goal": "Build bit reasoning, xor patterns, game states, and string invariants.",
        "tags": {"bitmasks", "games", "strings"},
    },
    {
        "id": "trees",
        "title": "Trees",
        "goal": "Practice DFS bookkeeping, rerooting, subtree states, and tree data structures.",
        "tags": {"trees"},
    },
    {
        "id": "graphs",
        "title": "Graphs",
        "goal": "Model states with BFS/DFS, components, shortest paths, and graph constraints.",
        "tags": {"graphs", "dfs and similar", "shortest paths", "dsu"},
    },
    {
        "id": "data-structures",
        "title": "Data Structures",
        "goal": "Strengthen segment trees, Fenwick trees, offline counting, and range query state.",
        "tags": {"data structures"},
    },
    {
        "id": "dp",
        "title": "Dynamic Programming",
        "goal": "Make state, transition, order, and compression automatic.",
        "tags": {"dp"},
    },
    {
        "id": "binary-two-pointers",
        "title": "Binary Search and Two Pointers",
        "goal": "Recognize monotonic predicates and maintain useful windows.",
        "tags": {"binary search", "two pointers"},
    },
    {
        "id": "constructive",
        "title": "Constructive Algorithms",
        "goal": "Build answers from invariants rather than search.",
        "tags": {"constructive algorithms"},
    },
    {
        "id": "math-number-theory",
        "title": "Math and Number Theory",
        "goal": "Use gcd, divisors, modular arithmetic, parity, and transformations.",
        "tags": {"math", "number theory"},
    },
    {
        "id": "greedy-sorting",
        "title": "Greedy and Sorting",
        "goal": "Turn observations into local choices, ordering arguments, and exchange proofs.",
        "tags": {"greedy", "sortings"},
    },
]


def fetch_json(url: str):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "cf2000-tracker/2.0",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return json.loads(body.decode("utf-8"))


def problem_url(problem: dict) -> str:
    return f"https://codeforces.com/problemset/problem/{problem['contestId']}/{problem['index']}"


def make_focus(problem: dict, track: dict) -> str:
    tags = set(problem.get("tags", []))
    matched = sorted(tags & track["tags"])
    if matched:
        return "Practice " + ", ".join(matched) + f" at {problem['rating']} level."
    return f"Practice this {problem['rating']} rated bridge problem."


def node_id(track_id: str, problem: dict) -> str:
    return f"{track_id}-{problem['contestId']}{problem['index']}".replace(" ", "")


def child_capacity(index: int) -> int:
    """Vary branching so the visual tree has one, two, and multi-child nodes."""
    return (4, 3, 2, 1, 3, 4, 2, 1)[index % 8]


def build_tree(items: list[dict]) -> list[dict]:
    """Build a compact variable-branching prerequisite tree."""
    child_counts = [0 for _ in items]
    open_parents = [0]
    parents = [None]

    for index in range(1, len(items)):
        while open_parents and child_counts[open_parents[0]] >= child_capacity(open_parents[0]):
            open_parents.pop(0)
        parent = open_parents[0] if open_parents else index - 1
        parents.append(parent)
        child_counts[parent] += 1
        open_parents.append(index)

    nodes = []
    by_index = []
    for i, item in enumerate(items):
        node = dict(item)
        node["children"] = []
        by_index.append(node)
        parent = parents[i]
        if parent is None:
            nodes.append(node)
        else:
            by_index[parent]["children"].append(node)
    return nodes


def drill_quota(track_index: int) -> dict[int, int]:
    return {
        1700: DRILL_TOTALS[1700] // len(TRACKS),
        1800: DRILL_TOTALS[1800] // len(TRACKS) + (1 if track_index < DRILL_TOTALS[1800] % len(TRACKS) else 0),
        1900: DRILL_TOTALS[1900] // len(TRACKS) + (1 if track_index >= len(TRACKS) - DRILL_TOTALS[1900] % len(TRACKS) else 0),
    }


def select_for_track(
    recent_problems: list[dict],
    track: dict,
    used: set[tuple[int, str]],
) -> list[dict]:
    selected: list[dict] = []

    def pool_for_rating(rating: int) -> list[dict]:
        return [
            problem for problem in recent_problems
            if problem["rating"] == rating
            and track["tags"] & set(problem.get("tags", []))
            and (problem["contestId"], problem["index"]) not in used
        ]

    for rating in BASE_RATINGS:
        for problem in pool_for_rating(rating)[:BASE_PER_RATING]:
            selected.append(problem)
            used.add((problem["contestId"], problem["index"]))

    for rating in BONUS_RATINGS:
        pool = pool_for_rating(rating)
        if not pool:
            continue
        problem = pool[0]
        selected.append(problem)
        used.add((problem["contestId"], problem["index"]))

    if len(selected) < BASE_PROBLEMS_PER_TRACK:
        pool = [
            problem for problem in recent_problems
            if track["tags"] & set(problem.get("tags", []))
            and (problem["contestId"], problem["index"]) not in used
        ]
        pool.sort(key=lambda item: (-item["rating"], -item["startTimeSeconds"], item["contestId"], item["index"]))
        for problem in pool:
            selected.append(problem)
            used.add((problem["contestId"], problem["index"]))
            if len(selected) == BASE_PROBLEMS_PER_TRACK:
                break

    if len(selected) != BASE_PROBLEMS_PER_TRACK:
        raise RuntimeError(f"Could not select {BASE_PROBLEMS_PER_TRACK} base problems for {track['id']}; got {len(selected)}")

    return selected


def add_drills(
    selected: list[dict],
    all_problems: list[dict],
    track: dict,
    track_index: int,
    used: set[tuple[int, str]],
) -> None:
    def pool_for_rating(rating: int, require_track_tag: bool = True) -> list[dict]:
        return [
            problem for problem in all_problems
            if problem["rating"] == rating
            and (not require_track_tag or track["tags"] & set(problem.get("tags", [])))
            and (problem["contestId"], problem["index"]) not in used
        ]

    for rating, count in drill_quota(track_index).items():
        rating_added = 0
        for require_track_tag in (True, False):
            pool = pool_for_rating(rating, require_track_tag)
            pool.sort(key=lambda item: (not item["recent"], -item["startTimeSeconds"], item["contestId"], item["index"]))
            for problem in pool:
                selected.append(problem)
                used.add((problem["contestId"], problem["index"]))
                rating_added += 1
                if rating_added == count:
                    break
            if rating_added == count:
                break
        if rating_added != count:
            raise RuntimeError(f"Could not select {count} drill problems at {rating} for {track['id']}; got {rating_added}")

    if len(selected) != PROBLEMS_PER_TRACK:
        raise RuntimeError(f"Could not select {PROBLEMS_PER_TRACK} problems for {track['id']}; got {len(selected)}")


def main() -> None:
    contests_payload = fetch_json("https://codeforces.com/api/contest.list?gym=false")
    problems_payload = fetch_json("https://codeforces.com/api/problemset.problems")

    if contests_payload.get("status") != "OK":
        raise RuntimeError("contest.list did not return OK")
    if problems_payload.get("status") != "OK":
        raise RuntimeError("problemset.problems did not return OK")

    cutoff_ts = int(CUTOFF.timestamp())
    finished_contests = {
        contest["id"]: contest
        for contest in contests_payload["result"]
        if contest.get("phase") == "FINISHED"
    }

    candidates = []
    for problem in problems_payload["result"]["problems"]:
        contest_id = problem.get("contestId")
        rating = problem.get("rating")
        if contest_id not in finished_contests or not rating:
            continue
        if problem.get("type") != "PROGRAMMING":
            continue
        if not MIN_RATING <= rating <= MAX_RATING:
            continue
        contest = finished_contests[contest_id]
        candidates.append({
            **problem,
            "contestName": contest["name"],
            "startTimeSeconds": contest["startTimeSeconds"],
            "date": dt.datetime.fromtimestamp(contest["startTimeSeconds"], dt.timezone.utc).date().isoformat(),
            "recent": contest.get("startTimeSeconds", 0) >= cutoff_ts,
        })

    recent_candidates = [candidate for candidate in candidates if candidate["recent"]]
    recent_candidates.sort(key=lambda item: (item["rating"], -item["startTimeSeconds"], item["contestId"], item["index"]))
    candidates.sort(key=lambda item: (item["rating"], not item["recent"], -item["startTimeSeconds"], item["contestId"], item["index"]))

    used: set[tuple[int, str]] = set()
    selected_by_track = []
    for track_index, track in enumerate(TRACKS):
        selected_by_track.append(select_for_track(recent_candidates, track, used))

    for track_index, track in enumerate(TRACKS):
        add_drills(selected_by_track[track_index], candidates, track, track_index, used)

    topics = []
    for track, selected in zip(TRACKS, selected_by_track):
        selected.sort(key=lambda item: (item["rating"], -item["startTimeSeconds"], item["contestId"], item["index"]))
        nodes = []
        for problem in selected:
            nodes.append({
                "id": node_id(track["id"], problem),
                "title": f"{problem['contestId']}{problem['index']} - {problem['name']}",
                "problemName": problem["name"],
                "contestId": problem["contestId"],
                "index": problem["index"],
                "rating": problem["rating"],
                "url": problem_url(problem),
                "tags": problem.get("tags", []),
                "focus": make_focus(problem, track),
                "contestName": problem["contestName"],
                "date": problem["date"],
                "sourceWindow": "recent" if problem["recent"] else "supplemental",
            })
        topics.append({
            "id": track["id"],
            "title": track["title"],
            "goal": track["goal"],
            "nodes": build_tree(nodes),
        })

    roadmap = {
        "title": "1700 to 2000 Codeforces Roadmap",
        "sourceNote": f"Generated from Codeforces contest.list and problemset.problems. Keeps a recent base from finished public contests dated {CUTOFF.date().isoformat()} onward, adds harder 1900-2200 stretch problems, and supplements extra 1700/1800/1900 drills from older finished contests where the recent pool is exhausted.",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "cutoffDate": CUTOFF.date().isoformat(),
        "drillAdds": DRILL_TOTALS,
        "problemCount": sum(1 for topic in topics for _ in flatten(topic["nodes"])),
        "topics": topics,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    ROADMAP_PATH.write_text(json.dumps(roadmap, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"Wrote {roadmap['problemCount']} problems to {ROADMAP_PATH}")


def flatten(nodes: list[dict]):
    for node in nodes:
        yield node
        yield from flatten(node.get("children", []))


if __name__ == "__main__":
    main()
