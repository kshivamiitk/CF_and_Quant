"""Verify curated exercise-video IDs and link metadata before release."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ExerciseVideoManifestTests(unittest.TestCase):
    def test_exact_catalog_ids_and_youtube_ids(self):
        catalog_source = (ROOT / "public/gym-library.js").read_text()
        catalog = json.loads(catalog_source.split("=", 1)[1].strip().rstrip(";"))
        known = {item["id"] for item in catalog}
        manifest = json.loads((ROOT / "public/data/exercise-videos.json").read_text())
        videos = manifest["entries"]
        self.assertTrue(videos)
        self.assertEqual(set(videos) - known, set())
        for canonical_id, video in videos.items():
            with self.subTest(exercise=canonical_id):
                self.assertRegex(video["videoId"], r"^[A-Za-z0-9_-]{11}$")
                self.assertTrue(video["title"] and video["publisher"] and video["variant"])
        self.assertEqual(videos["CH01"]["variant"], "Flat barbell bench press")
        self.assertEqual(videos["CO21"]["variant"], "Forearm front plank")
        self.assertEqual(videos["BK36"]["videoId"], videos["HG01"]["videoId"])


if __name__ == "__main__":
    unittest.main()
