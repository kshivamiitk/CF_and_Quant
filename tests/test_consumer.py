import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from api import consumer
from api.account import delete_account
from api.auth import authenticate_request, is_legacy_owner


class ConsumerRecordTests(unittest.TestCase):
    def test_idempotent_write_and_account_isolation(self):
        first = str(uuid.uuid4())
        second = str(uuid.uuid4())
        record = str(uuid.uuid4())
        body = json.dumps({"recordId": record, "kind": "water", "occurredAt": "2026-10-19T08:00:00Z",
                           "payload": {"amountMl": 250}}).encode()
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            claims_a = {"sub": first, "aud": "local"}
            claims_b = {"sub": second, "aud": "local"}
            self.assertEqual(consumer.handle("POST", body, claims_a, "")[0], 200)
            self.assertEqual(consumer.handle("POST", body, claims_a, "")[0], 200)
            self.assertEqual(len(consumer.handle("GET", b"", claims_a, "")[1]["records"]), 1)
            self.assertEqual(consumer.handle("GET", b"", claims_b, "")[1]["records"], [])
            consumer.handle("DELETE", json.dumps({"recordId": record}).encode(), claims_b, "")
            self.assertEqual(len(consumer.handle("GET", b"", claims_a, "")[1]["records"]), 1)

    def test_favorites_custom_exercises_and_sessions_are_account_scoped(self):
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        records = [
            ("favorite", {"exerciseId": "CH01"}),
            ("custom_exercise", {"name": "My cable variation", "mode": "load_reps", "category": "Custom"}),
            ("routine", {"title": "My bench routine", "exerciseIds": ["CH01"]}),
            ("workout", {"title": "Bench day", "status": "completed", "sets": [{"exerciseId": "CH01", "exercise": "Barbell flat bench press", "reps": 8, "weightKg": 40, "complete": True}]})
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            for kind, payload in records:
                body = json.dumps({"recordId": str(uuid.uuid4()), "kind": kind, "occurredAt": "2026-10-19T08:00:00Z", "payload": payload}).encode()
                self.assertEqual(consumer.handle("POST", body, {"sub": first, "aud": "local"}, "")[0], 200)
            for kind in ("favorite", "custom_exercise", "routine", "workout"):
                self.assertEqual(len(consumer.handle("GET", b"", {"sub": first, "aud": "local"}, "", kind=kind)[1]["records"]), 1)
                self.assertEqual(consumer.handle("GET", b"", {"sub": second, "aud": "local"}, "", kind=kind)[1]["records"], [])

    def test_invalid_values_rejected(self):
        claims = {"sub": str(uuid.uuid4()), "aud": "local"}
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            for kind, payload in [("water", {"amountMl": -1}), ("workout", {"title": "", "sets": []}),
                                  ("care_log", {"itemId": "wrong", "status": "taken"})]:
                body = json.dumps({"recordId": str(uuid.uuid4()), "kind": kind,
                                   "occurredAt": "2026-10-19T08:00:00Z", "payload": payload}).encode()
                self.assertEqual(consumer.handle("POST", body, claims, "")[0], 400)

    def test_history_pagination_for_complete_export(self):
        user = str(uuid.uuid4())
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            consumer._local_write(user, [{"record_id": str(uuid.uuid4()), "kind": "water", "occurred_at": "2026-10-19T08:00:00+00:00", "payload": {"amountMl": 1}} for _ in range(301)])
            self.assertEqual(len(consumer.handle("GET", b"", {"sub": user, "aud": "local"}, "", 0)[1]["records"]), 300)
            self.assertEqual(len(consumer.handle("GET", b"", {"sub": user, "aud": "local"}, "", 300)[1]["records"]), 1)

    def test_kind_reads_keep_old_active_and_profile_visible_after_many_samples(self):
        user = str(uuid.uuid4())
        old = "2026-01-01T08:00:00+00:00"
        recent = "2026-10-19T08:00:00+00:00"
        profile = {"record_id": str(uuid.uuid4()), "kind": "profile", "occurred_at": old, "payload": {"unit": "imperial"}, "revision": 1}
        workout = {"record_id": str(uuid.uuid4()), "kind": "workout", "occurred_at": old, "payload": {"status": "active", "sets": []}, "revision": 1}
        samples = [{"record_id": str(uuid.uuid4()), "kind": "health_sample", "occurred_at": recent,
                    "payload": {"metricType": "steps"}, "revision": 1} for _ in range(350)]
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            consumer._local_write(user, samples + [profile, workout])
            claims = {"sub": user, "aud": "local"}
            self.assertEqual(len(consumer.handle("GET", b"", claims, "")[1]["records"]), 300)
            self.assertEqual(consumer.handle("GET", b"", claims, "", kind="profile")[1]["records"][0]["record_id"], profile["record_id"])
            self.assertEqual(consumer.handle("GET", b"", claims, "", kind="workout")[1]["records"][0]["record_id"], workout["record_id"])

    def test_revision_prevents_stale_overwrite_and_delete_resurrection(self):
        user = str(uuid.uuid4())
        record = str(uuid.uuid4())
        claims = {"sub": user, "aud": "local"}
        def body(title, expected):
            return json.dumps({"recordId": record, "kind": "workout", "occurredAt": "2026-10-19T08:00:00Z",
                               "expectedRevision": expected, "payload": {"title": title, "sets": [], "status": "active"}}).encode()
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            self.assertEqual(consumer.handle("POST", body("Initial", 0), claims, "")[1]["record"]["revision"], 1)
            self.assertEqual(consumer.handle("POST", body("New online edit", 1), claims, "")[1]["record"]["revision"], 2)
            self.assertEqual(consumer.handle("POST", body("Old queued edit", 1), claims, "")[0], 409)
            self.assertEqual(consumer.handle("GET", b"", claims, "", kind="workout")[1]["records"][0]["payload"]["title"], "New online edit")
            self.assertEqual(consumer.handle("DELETE", json.dumps({"recordId": record, "expectedRevision": 1}).encode(), claims, "")[0], 409)
            self.assertEqual(consumer.handle("DELETE", json.dumps({"recordId": record, "expectedRevision": 2}).encode(), claims, "")[0], 200)
            self.assertEqual(consumer.handle("POST", body("Old queued edit", 1), claims, "")[0], 409)

    def test_scheduled_checkin_is_idempotent_and_owned(self):
        first = str(uuid.uuid4())
        second = str(uuid.uuid4())
        item = str(uuid.uuid4())
        claims = {"sub": first, "aud": "local"}
        item_body = json.dumps({"recordId": item, "kind": "care_item", "occurredAt": "2026-10-19T08:00:00Z",
                                "payload": {"name": "Personal item", "type": "supplement", "times": ["09:00"]}}).encode()
        occurrence = f"{item}:2026-10-19:09:00"
        def checkin(status, expected=0):
            return json.dumps({"recordId": str(uuid.uuid4()), "kind": "care_log", "occurredAt": "2026-10-19T09:00:00Z",
                               "payload": {"itemId": item, "status": status, "occurrenceId": occurrence}, "expectedRevision": expected}).encode()
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            self.assertEqual(consumer.handle("POST", item_body, claims, "")[0], 200)
            self.assertEqual(consumer.handle("POST", checkin("taken"), claims, "")[0], 200)
            self.assertEqual(consumer.handle("POST", checkin("skipped"), claims, "")[0], 409)
            self.assertEqual(consumer.handle("POST", checkin("skipped", 1), claims, "")[0], 200)
            self.assertEqual(len([row for row in consumer.handle("GET", b"", claims, "")[1]["records"] if row["kind"] == "care_log"]), 1)
            self.assertEqual(consumer.handle("POST", checkin("taken"), {"sub": second, "aud": "local"}, "")[0], 404)

    def test_source_sample_preserves_provenance_and_tombstone(self):
        user = str(uuid.uuid4())
        sample = str(uuid.uuid4())
        claims = {"sub": user, "aud": "local"}
        base = {"recordId": sample, "kind": "health_sample", "occurredAt": "2026-10-19T08:00:00Z",
                "payload": {"metricType": "heart_rate", "unit": "bpm", "value": 72,
                            "sampleStart": "2026-10-19T07:59:00Z", "sampleEnd": "2026-10-19T08:00:00Z",
                            "sourceId": "test.device", "sourceSampleId": sample, "sourceName": "Test device"}}
        with tempfile.TemporaryDirectory() as directory, patch.object(consumer, "LOCAL_DIR", Path(directory)):
            self.assertEqual(consumer.handle("POST", json.dumps(base).encode(), claims, "")[0], 200)
            self.assertEqual(consumer.handle("POST", json.dumps(base).encode(), claims, "")[0], 200)
            self.assertEqual(len(consumer.handle("GET", b"", claims, "")[1]["records"]), 1)
            tombstone = dict(base)
            tombstone["payload"] = {"metricType": "heart_rate", "unit": "bpm", "sourceId": "test.device", "sourceSampleId": sample, "deleted": True}
            self.assertEqual(consumer.handle("POST", json.dumps(tombstone).encode(), claims, "")[0], 200)
            self.assertTrue(consumer.handle("GET", b"", claims, "")[1]["records"][0]["payload"]["deleted"])
            self.assertEqual(consumer.handle("DELETE", b'{"allImported":true}', {"sub": str(uuid.uuid4()), "aud": "local"}, "")[1]["removed"], 0)
            self.assertEqual(consumer.handle("DELETE", b'{"allImported":true}', claims, "")[1]["removed"], 1)

    def test_owner_flag_only_matches_configured_user(self):
        first = str(uuid.uuid4())
        with patch.dict("os.environ", {"SUPABASE_OWNER_USER_ID": first}):
            self.assertTrue(is_legacy_owner({"sub": first}))
            self.assertFalse(is_legacy_owner({"sub": str(uuid.uuid4())}))

    def test_account_deletion_requires_real_auth_and_confirmation(self):
        user = str(uuid.uuid4())
        with patch.dict("os.environ", {"SUPABASE_OWNER_USER_ID": "", "SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": "test-only"}):
            self.assertEqual(delete_account(b'{}', {"sub": user, "aud": "local"}, "")[0], 403)
            self.assertEqual(delete_account(b'{}', {"sub": user, "aud": "authenticated"}, "Bearer token")[0], 400)
            with patch("api.account.urlopen") as request:
                request.return_value.__enter__.return_value = object()
                status, result = delete_account(b'{"confirm":"DELETE MY ACCOUNT"}', {"sub": user, "aud": "authenticated"}, "Bearer token")
                self.assertEqual(status, 200)
                self.assertTrue(result["deleted"])
                request.assert_called_once()

    def test_verified_tokens_accept_distinct_users_but_reject_wrong_issuer(self):
        import datetime as dt
        import jwt
        from cryptography.hazmat.primitives.asymmetric import ec
        key = ec.generate_private_key(ec.SECP256R1())
        signing_key = type("SigningKey", (), {"key": key.public_key()})()
        client = type("Client", (), {"get_signing_key_from_jwt": lambda self, token: signing_key})()
        owner = str(uuid.uuid4())
        other = str(uuid.uuid4())
        with patch.dict("os.environ", {"ALLOW_LOCAL_DEV_AUTH": "0", "SUPABASE_OWNER_USER_ID": owner,
                                        "SUPABASE_AUTH_ISSUER": "https://auth.example.test", "SUPABASE_AUTH_AUDIENCE": "authenticated"}), patch("api.auth._jwk_client", return_value=client):
            for subject in (owner, other):
                token = jwt.encode({"sub": subject, "aud": "authenticated", "iss": "https://auth.example.test",
                                    "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)}, key, algorithm="ES256")
                self.assertEqual(authenticate_request({"Authorization": "Bearer " + token})["sub"], subject)
            bad_token = jwt.encode({"sub": other, "aud": "authenticated", "iss": "https://wrong.example.test",
                                    "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)}, key, algorithm="ES256")
            self.assertIsNone(authenticate_request({"Authorization": "Bearer " + bad_token}))

    def test_local_bypass_is_disabled_in_production(self):
        with patch.dict("os.environ", {"ALLOW_LOCAL_DEV_AUTH": "1", "VERCEL": "1"}):
            self.assertIsNone(authenticate_request({}))


if __name__ == "__main__":
    unittest.main()
