import unittest
import uuid

from tools.migrate_owner_to_consumer import transform


class MigrationTests(unittest.TestCase):
    def test_preserves_ids_dates_and_repeatability(self):
        owner = str(uuid.uuid4())
        source = {"gymExerciseSessions": [{"id": "legacy-1", "exerciseId": "CH01", "date": "2025-05-11",
                                           "title": "Bench day", "sets": [{"id": "old-set", "weightKg": 50, "reps": 8}]}]}
        first, errors = transform(source, owner)
        second, _ = transform(source, owner)
        self.assertEqual(errors, [])
        self.assertEqual(first, second)
        self.assertEqual(first[0]["payload"]["sets"][0]["exerciseId"], "CH01")
        self.assertEqual(first[0]["payload"]["sets"][0]["legacySetId"], "old-set")
        self.assertEqual(first[0]["payload"]["legacyOriginalDate"], "2025-05-11")
        self.assertEqual(first[0]["occurred_at"], "2025-05-11T00:00:00Z")

    def test_ambiguous_or_unknown_exercise_is_not_invented(self):
        rows, errors = transform({"gymExerciseSessions": [{"id": "x", "exerciseId": "A mystery", "date": "2025-05-11"}]}, str(uuid.uuid4()))
        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)


if __name__ == "__main__":
    unittest.main()
