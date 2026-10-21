"""Run with python -m unittest tests.browser_smoke; install Playwright and Chromium first."""

import os
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import urlopen

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("WELLFRAME_CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
LAUNCH = {"executable_path": CHROME} if Path(CHROME).exists() else {}


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@unittest.skipUnless(sync_playwright, "Playwright is needed")
class ConsumerBrowserSmoke(unittest.TestCase):
    def test_offline_reload_and_newer_edit_supersedes_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            port = free_port()
            env = dict(os.environ, ALLOW_LOCAL_DEV_AUTH="1", SUPABASE_OWNER_USER_ID="", CONSUMER_LOCAL_DATA_DIR=directory)
            process = subprocess.Popen([sys.executable, "server.py", "--port", str(port)], cwd=ROOT,
                                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(50):
                    try:
                        urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                        break
                    except Exception:
                        time.sleep(.1)
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(**LAUNCH, headless=True)
                    context = browser.new_context(service_workers="block")
                    page = context.new_page()
                    api_trace = []
                    page.on("response", lambda response: api_trace.append((response.request.method, response.status)) if "/api/consumer" in response.url else None)
                    page.on("requestfailed", lambda request: api_trace.append((request.method, "failed")) if "/api/consumer" in request.url else None)
                    page.goto(f"http://127.0.0.1:{port}/")
                    page.locator('[data-consumer-tab="train"]').click()
                    page.get_by_role("button", name="Start a workout").click()
                    page.locator("#wfWorkoutTitle").wait_for()
                    page.route("**/api/consumer**", lambda route: route.abort())
                    page.locator("#wfWorkoutTitle").fill("Old queued edit")
                    page.wait_for_timeout(700)
                    page.reload()
                    page.locator('[data-consumer-tab="train"]').click()
                    self.assertEqual(page.locator("#wfWorkoutTitle").input_value(), "Old queued edit")
                    page.unroute_all(behavior="wait")
                    page.locator("#wfWorkoutTitle").fill("New online edit")
                    page.wait_for_timeout(900)
                    self.assertNotIn("pending", page.locator("#consumerStatus").inner_text().lower())
                    page.reload()
                    page.locator('[data-consumer-tab="train"]').click()
                    self.assertEqual(page.locator("#wfWorkoutTitle").input_value(), "New online edit")
                    records = json.load(urlopen(f"http://127.0.0.1:{port}/api/consumer?kind=workout"))["records"]
                    self.assertEqual(len(records), 1)
                    self.assertEqual(records[0]["payload"]["title"], "New online edit", f"trace={api_trace!r}; status={page.locator('#consumerStatus').inner_text()!r}; pending={page.evaluate('Object.keys(localStorage).filter(k => k.startsWith(\"wf_pending_\")).map(k => localStorage.getItem(k))')!r}")
                    browser.close()
            finally:
                process.terminate()
                process.wait(timeout=5)

    def test_login_gate_hides_after_restored_session(self):
        port = free_port()
        process = subprocess.Popen([sys.executable, "server.py", "--port", str(port)], cwd=ROOT,
                                   env=dict(os.environ, ALLOW_LOCAL_DEV_AUTH="0"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try:
                    urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                    break
                except Exception:
                    time.sleep(.1)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(**LAUNCH, headless=True)
                context = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
                page = context.new_page()
                page.route("**/api/auth/config", lambda route: route.fulfill(json={"url": f"http://127.0.0.1:{port}", "publishableKey": "test-key"}))
                def auth_token(route):
                    headers = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "apikey, content-type"}
                    if route.request.method == "OPTIONS":
                        route.fulfill(status=204, headers=headers)
                    else:
                        route.fulfill(headers=headers, json={"access_token": "test-token", "refresh_token": "test-refresh", "expires_in": 3600})
                page.route("**/auth/v1/**", auth_token)
                page.route("**/api/auth/me", lambda route: route.fulfill(status=200, json={"legacyOwner": False, "userId": "test-user"}) if route.request.headers.get("authorization") == "Bearer test-token" else route.fulfill(status=401, json={"error": "Authentication required"}))
                page.route("**/api/consumer", lambda route: route.fulfill(json={"records": [], "development": True}))
                page.goto(f"http://127.0.0.1:{port}/")
                page.locator("#authGate").wait_for(state="visible")
                page.locator('#authForm [name="email"]').fill("fixture@example.test")
                page.locator('#authForm [name="password"]').fill("test-password")
                page.locator("#authSubmit").click()
                try:
                    page.get_by_text("Good to see you, there.").wait_for(timeout=10000)
                except Exception as error:
                    raise AssertionError(f"Sign-in did not reach Today; status={page.locator('#authStatus').inner_text()!r}, url={page.url!r}") from error
                self.assertTrue(page.locator("#authGate").is_hidden())
                page.reload()
                page.get_by_text("Good to see you, there.").wait_for()
                self.assertTrue(page.locator("#authGate").is_hidden())
                browser.close()
        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_manual_first_value_and_resumption(self):
        with tempfile.TemporaryDirectory() as directory:
            port = free_port()
            env = dict(os.environ, ALLOW_LOCAL_DEV_AUTH="1", SUPABASE_OWNER_USER_ID="", CONSUMER_LOCAL_DATA_DIR=directory)
            process = subprocess.Popen([sys.executable, "server.py", "--port", str(port)], cwd=ROOT,
                                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(50):
                    try:
                        urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                        break
                    except Exception:
                        time.sleep(.1)
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(**LAUNCH, headless=True)
                    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1, reduced_motion="reduce")
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(f"http://127.0.0.1:{port}/")
                    page.get_by_text("Good to see you, there.").wait_for()
                    self.assertTrue(page.locator("#authGate").is_hidden())
                    self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth - innerWidth"), 1)
                    page.get_by_role("button", name="Explore exercises").click()
                    self.assertEqual(page.locator(".wf-exercise-card").count(), 30)
                    page.get_by_role("button", name="Show more").click()
                    self.assertEqual(page.locator(".wf-exercise-card").count(), 60)
                    page.locator("#wfExerciseSearch").fill("Barbell flat bench press")
                    screenshot_dir = os.environ.get("WELLFRAME_SCREENSHOT_DIR")
                    if screenshot_dir:
                        Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(Path(screenshot_dir) / "train-library-phone.png"), full_page=True)
                    page.get_by_role("button", name="Details").first.click()
                    page.get_by_text("Pose A illustration").wait_for()
                    self.assertEqual(page.locator('.wf-form-preview iframe').count(), 0)
                    self.assertIn('CayG6UYqL8g', page.locator('.wf-form-preview a').first.get_attribute('href'))
                    page.route('https://www.youtube-nocookie.com/**', lambda route: route.fulfill(body='<html><body>Video player fixture</body></html>'))
                    page.get_by_role("button", name="Play Barbell flat bench press form video").click()
                    self.assertIn('youtube-nocookie.com/embed/CayG6UYqL8g', page.locator('.wf-form-preview iframe').get_attribute('src'))
                    if screenshot_dir:
                        page.screenshot(path=str(Path(screenshot_dir) / "exercise-detail-phone.png"), full_page=True)
                    page.get_by_role("button", name="Add to workout").click()
                    page.locator('[data-field="reps"]').first.fill("8")
                    page.locator('[data-field="weightKg"]').first.fill("40")
                    page.locator('[data-field="complete"]').first.check()
                    page.get_by_role("button", name="+ Add set").click()
                    page.wait_for_function("document.querySelectorAll('[data-field=\"reps\"]').length === 2")
                    page.get_by_role("button", name="+ Add set").click()
                    page.wait_for_function("document.querySelectorAll('[data-field=\"reps\"]').length === 3")
                    page.get_by_role("button", name="Move set 1 down").click()
                    self.assertEqual(page.locator('[data-field="reps"]').nth(1).input_value(), "8")
                    page.get_by_role("button", name="Move set 2 up").click()
                    self.assertEqual(page.locator('[data-field="reps"]').first.input_value(), "8")
                    self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth - innerWidth"), 1)
                    page.get_by_role("button", name="Start 90 sec").click()
                    page.get_by_text("remaining").wait_for()
                    page.get_by_role("button", name="Save as routine").click()
                    page.locator("dialog").get_by_role("button", name="Save routine").click()
                    page.get_by_text("My routines").wait_for()
                    page.wait_for_timeout(900)
                    page.reload()
                    page.locator('[data-consumer-tab="train"]').click()
                    page.get_by_text("Record your sets").wait_for()
                    self.assertEqual(page.locator('[data-field="reps"]').count(), 3)
                    self.assertEqual(page.locator('[data-field="reps"]').first.input_value(), "8")
                    page.get_by_text("remaining").wait_for()
                    page.get_by_role("button", name="Show form").click()
                    page.locator("#wfFormDialog").wait_for(state="visible")
                    self.assertEqual(page.locator('#wfFormDialog iframe').count(), 0)
                    page.locator('#wfFormDialog').get_by_role("button", name="Play Barbell flat bench press form video").click()
                    self.assertIn('CayG6UYqL8g', page.locator('#wfFormDialog iframe').get_attribute('src'))
                    page.get_by_role("button", name="Close").click()
                    page.get_by_role("button", name="Finish workout").click()
                    page.get_by_text("WORKOUT RECORDED").wait_for()
                    page.get_by_role("button", name="View or correct workout").click()
                    page.locator('[data-field="reps"]').first.fill("9")
                    page.get_by_role("button", name="Save corrections").click()
                    page.reload()
                    page.locator('[data-consumer-tab="train"]').click()
                    page.get_by_role("button", name="View / correct").click()
                    self.assertEqual(page.locator('[data-field="reps"]').first.input_value(), "9")
                    page.get_by_role("button", name="Back to Train").click()
                    page.get_by_text("Recent workouts").wait_for()
                    page.get_by_role("button", name="Browse exercises").click()
                    page.locator("#wfExerciseSearch").fill("Barbell flat bench press")
                    page.get_by_role("button", name="Details").first.click()
                    page.get_by_text("YOUR PROGRESS").wait_for()
                    page.get_by_text("Recorded best:").wait_for()
                    page.get_by_role("button", name="All", exact=True).click()
                    self.assertEqual(page.get_by_role("button", name="All", exact=True).get_attribute("aria-pressed"), "true")
                    page.get_by_text("View exercise values").click()
                    self.assertEqual(page.locator("table tbody tr").count(), 1)
                    page.get_by_role("button", name="Back to library").click()
                    page.get_by_role("button", name="Back to Train").click()
                    page.locator('[data-consumer-tab="today"]').click()
                    page.get_by_role("button", name="Log water").click()
                    page.locator('#wfWaterForm [name="amountMl"]').fill("250")
                    page.locator('#wfWaterForm button[type="submit"]').click()
                    page.get_by_text("250 ml").first.wait_for()
                    page.locator('[data-consumer-tab="trends"]').click()
                    page.get_by_text("250 ml").first.wait_for()
                    page.get_by_role("button", name="30 days").click()
                    self.assertEqual(page.get_by_role("button", name="30 days").get_attribute("aria-pressed"), "true")
                    page.locator('[data-consumer-tab="care"]').click()
                    page.locator('#wfCareForm [name="name"]').fill("Test item")
                    page.locator('#wfCareForm [name="time"]').fill("09:00")
                    page.get_by_role("button", name="Add item").click()
                    page.get_by_text("Test item").wait_for()
                    page.get_by_role("button", name="Log taken").click()
                    page.get_by_text("Today: taken").wait_for()
                    page.get_by_role("button", name="Undo").click()
                    page.get_by_text("Today: taken").wait_for(state="detached")
                    page.locator('[data-consumer-tab="you"]').click()
                    page.locator('#wfProfileForm [name="unit"]').select_option("imperial")
                    page.locator('#wfProfileForm [name="interest"]').select_option("Strength")
                    page.get_by_role("button", name="Save preferences").click()
                    page.reload()
                    page.locator('[data-consumer-tab="you"]').click()
                    self.assertEqual(page.locator('#wfProfileForm [name="unit"]').input_value(), "imperial")
                    self.assertEqual(page.locator('#wfProfileForm [name="interest"]').input_value(), "Strength")
                    page.locator('[data-consumer-tab="train"]').click()
                    page.get_by_role("button", name="View / correct").click()
                    self.assertEqual(page.locator('[data-field="weightKg"]').first.input_value(), "88.2")
                    page.get_by_role("button", name="Back to Train").click()
                    page.get_by_role("button", name="Browse exercises").click()
                    page.locator("#wfExerciseSearch").fill("RC10")
                    page.get_by_text("Serratus cable punches").wait_for()
                    self.assertIn("no form image available", page.locator(".wf-exercise-card img").first.get_attribute("alt"))
                    page.get_by_role("button", name="Details").click()
                    self.assertEqual(page.get_by_role("button", name="Play form preview").count(), 0)
                    self.assertIn('youtube.com/results?search_query=', page.get_by_role("link", name="Search YouTube (not reviewed)").get_attribute("href"))
                    page.get_by_role("button", name="Back to library").click()
                    page.get_by_role("button", name="☆ Save").click()
                    page.locator('#wfCustomExerciseForm [name="name"]').fill("My test move")
                    page.get_by_role("button", name="Add custom exercise").click()
                    page.wait_for_timeout(300)
                    custom_records = json.load(urlopen(f"http://127.0.0.1:{port}/api/consumer?kind=custom_exercise"))["records"]
                    self.assertEqual(len(custom_records), 1, f"status={page.locator('#consumerStatus').inner_text()!r}; errors={errors!r}; form={page.locator('#wfCustomExerciseForm').count()}")
                    page.reload()
                    page.locator('[data-consumer-tab="train"]').click()
                    page.get_by_role("button", name="Browse exercises").click()
                    page.locator("#wfExerciseSearch").fill("RC10")
                    self.assertEqual(page.get_by_role("button", name="★ Saved").get_attribute("aria-pressed"), "true")
                    page.locator("#wfExerciseSearch").fill("My test move")
                    page.get_by_text("My test move").wait_for()
                    page.get_by_role("button", name="Back to Train").click()
                    page.get_by_role("button", name="Start routine").click()
                    page.get_by_text("Record your sets").wait_for()
                    self.assertEqual(page.locator('[data-field="reps"]').count(), 1)
                    self.assertEqual(errors, [])
                    browser.close()
            finally:
                process.terminate()
                process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
