"""Regression checks for the deployed Vercel catch-all API rewrite."""

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from api.index import api_route, original_api_path


ROOT = Path(__file__).resolve().parents[1]


class VercelRoutingTests(unittest.TestCase):
    def test_rewrite_preserves_route_for_python_handler(self):
        config = json.loads((ROOT / "vercel.json").read_text())
        self.assertEqual(config["rewrites"][0], {
            "source": "/api/:route*",
            "destination": "/api/index.py?__wellframe_route=:route*",
        })
        self.assertEqual(original_api_path("/api/index.py?__wellframe_route=auth%2Fconfig"), "/api/auth/config")
        self.assertEqual(
            original_api_path("/api/index.py?__wellframe_route=consumer&kind=workout&offset=20"),
            "/api/consumer?kind=workout&offset=20",
        )

    def test_public_auth_config_is_available_after_rewrite(self):
        with patch.dict("os.environ", {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "test-publishable-key",
        }):
            response = api_route("GET", "/api/index.py?__wellframe_route=auth%2Fconfig")
        self.assertEqual(response["status"], 200)
        self.assertEqual(json.loads(response["body"]), {
            "url": "https://example.supabase.co",
            "publishableKey": "test-publishable-key",
        })
        self.assertEqual(api_route("GET", "/api/index.py?__wellframe_route=auth%2Fme")["status"], 401)

    def test_untrusted_route_cannot_escape_api_namespace(self):
        for route in ("..%2Fpersonal", "%2Fauth%2Fconfig", "auth%2F..%2Fconfig", "auth%3Fconfig"):
            with self.subTest(route=route):
                self.assertEqual(
                    api_route("GET", "/api/index.py?__wellframe_route=" + route)["status"],
                    401,
                )


if __name__ == "__main__":
    unittest.main()
