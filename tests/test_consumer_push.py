"""Care push matching is account-owned, timely and opt-in."""

import unittest
import base64
from datetime import datetime, timezone
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from api import consumer_push
from api.consumer import validate


USER = "90000000-0000-4000-8000-000000000001"
ITEM = "90000000-0000-4000-8000-000000000002"
NOW = datetime(2026, 10, 21, 3, 31, tzinfo=timezone.utc)  # 09:01 in Kolkata
SUBSCRIPTION = {"subscription": {"endpoint": "https://web.push.apple.com/Q123", "keys": {"p256dh": "a" * 65, "auth": "b" * 22}}}


class ConsumerPushTests(unittest.TestCase):
    def test_workout_reminder_time_is_validated(self):
        self.assertEqual(validate("profile", {"workoutReminderTime": "18:30"})["workoutReminderTime"], "18:30")
        with self.assertRaises(ValueError):
            validate("profile", {"workoutReminderTime": "25:99"})

    def test_raw_web_push_vapid_key_is_normalized_for_python_sender(self):
        private = ec.generate_private_key(ec.SECP256R1())
        raw = private.private_numbers().private_value.to_bytes(32, "big")
        encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
        with patch.dict("os.environ", {"VAPID_PRIVATE_KEY": encoded}):
            der_encoded = consumer_push.vapid_private_key()
        der = base64.urlsafe_b64decode(der_encoded + "=" * (-len(der_encoded) % 4))
        self.assertEqual(serialization.load_der_private_key(der, password=None).private_numbers().private_value, private.private_numbers().private_value)

    def test_subscription_rejects_untrusted_endpoints_and_local_accounts(self):
        with self.assertRaises(ValueError):
            consumer_push._subscription({"subscription": {**SUBSCRIPTION["subscription"], "endpoint": "http://127.0.0.1/private"}})
        with self.assertRaises(ValueError):
            consumer_push._subscription({"subscription": {**SUBSCRIPTION["subscription"], "endpoint": "https://evil.example/collect"}})
        with self.assertRaises(ValueError):
            consumer_push._user_id({"sub": USER, "aud": "local"})
        endpoint_hash, clean = consumer_push._subscription(SUBSCRIPTION)
        self.assertEqual(len(endpoint_hash), 64)
        self.assertEqual(clean["endpoint"], SUBSCRIPTION["subscription"]["endpoint"])

    def test_due_care_uses_local_time_and_checkin(self):
        item = {"user_id": USER, "record_id": ITEM, "payload": {"name": "Private medicine", "timezone": "Asia/Kolkata", "times": ["09:00"], "paused": False}}
        due = consumer_push.due_care([item], [], NOW)
        self.assertEqual(due, [{"user_id": USER, "occurrence": f"{ITEM}:2026-10-21:09:00"}])
        log = {"user_id": USER, "payload": {"itemId": ITEM, "occurrenceId": due[0]["occurrence"], "status": "taken"}, "occurred_at": NOW.isoformat()}
        self.assertEqual(consumer_push.due_care([item], [log], NOW), [])
        item["payload"]["paused"] = True
        self.assertEqual(consumer_push.due_care([item], [], NOW), [])

    def test_workout_nudge_skips_a_session_already_started_today(self):
        profile = {"user_id": USER, "payload": {"timezone": "Asia/Kolkata", "workoutReminderTime": "09:00"}}
        due = consumer_push.due_workouts([profile], [], NOW)
        self.assertEqual(due, [{"user_id": USER, "occurrence": "workout:2026-10-21:09:00", "type": "workout"}])
        started = {"user_id": USER, "payload": {"status": "active"}, "occurred_at": NOW.isoformat()}
        self.assertEqual(consumer_push.due_workouts([profile], [started], NOW), [])
        self.assertEqual(consumer_push.due_workouts([profile], [], datetime(2026, 10, 21, 4, 0, tzinfo=timezone.utc)), [])

    def test_dispatch_sends_generic_once_and_claims_occurrence(self):
        item = {"user_id": USER, "record_id": ITEM, "payload": {"name": "Private medicine", "timezone": "Asia/Kolkata", "times": ["09:00"]}}
        subscription = {"user_id": USER, "endpoint_hash": "a" * 64, "subscription": SUBSCRIPTION["subscription"]}
        claims = [[{"user_id": USER, "occurrence_key": f"{ITEM}:2026-10-21:09:00"}], []]

        def db(method, table, query=None, payload=None, **kwargs):
            if table == "consumer_push_deliveries" and method == "POST":
                return claims.pop(0)
            return []

        with patch.object(consumer_push, "configured", return_value=True), patch.object(consumer_push, "_rows", side_effect=[[subscription], [item], [], [], [], [subscription], [item], [], [], []]), patch.object(consumer_push, "_db", side_effect=db), patch.object(consumer_push, "_send", return_value="sent") as send:
            self.assertEqual(consumer_push.dispatch(NOW)["sent"], 1)
            self.assertEqual(consumer_push.dispatch(NOW)["sent"], 0)
            self.assertEqual(send.call_count, 1)
            self.assertNotIn("Private medicine", str(send.call_args))

    def test_dispatch_workout_uses_training_deep_link(self):
        subscription = {"user_id": USER, "endpoint_hash": "a" * 64, "subscription": SUBSCRIPTION["subscription"]}
        profile = {"user_id": USER, "payload": {"timezone": "Asia/Kolkata", "workoutReminderTime": "09:00"}}
        with patch.object(consumer_push, "configured", return_value=True), patch.object(consumer_push, "_rows", side_effect=[[subscription], [], [], [profile], []]), patch.object(consumer_push, "_db", return_value=[{"occurrence_key": "workout:2026-10-21:09:00"}]), patch.object(consumer_push, "_send", return_value="sent") as send:
            self.assertEqual(consumer_push.dispatch(NOW)["sent"], 1)
            self.assertEqual(send.call_args.args[1]["url"], "/?tab=train")

    def test_send_test_only_uses_this_accounts_saved_subscription(self):
        with patch.object(consumer_push, "_db", side_effect=[[], []]), patch.object(consumer_push, "_send") as send:
            with self.assertRaises(ValueError):
                consumer_push.send_test({"sub": USER, "aud": "authenticated"}, SUBSCRIPTION)
            send.assert_not_called()
        with patch.object(consumer_push, "_db", side_effect=[[{"subscription": SUBSCRIPTION["subscription"]}], [{"occurrence_key": "test"}]]), patch.object(consumer_push, "_send", return_value="sent") as send:
            self.assertEqual(consumer_push.send_test({"sub": USER, "aud": "authenticated"}, SUBSCRIPTION), {"sent": True})
            self.assertEqual(send.call_args.args[1]["url"], "/?tab=care")


if __name__ == "__main__":
    unittest.main()
