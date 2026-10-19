# Corrective implementation pass — 19 October 2026

## Walkthrough with a synthetic account

Sign in to Wellframe (or run local development auth), open Today → Explore exercises → Train library. Search for **Barbell flat bench press (CH01)**; the card uses a local RepDB thumbnail and Details shows two labeled illustrations, attribution and the unreviewed-technique notice. Add to workout, enter reps and load, add two more sets, mark completed sets, and reload. The active session resumes with three sets. Finish it; Train history offers View / correct and Reuse. Reopen the exercise detail to see recorded best, dated working-set values, and 30/90-day or all-time ranges. Trends shows completed working sets and recorded load volume with a daily table. At phone width, the active-workout bar remains available from other tabs. The browser test exercises this path with synthetic data.

## Changed functions and routes

- `public/consumer.js`: `start` loads records by kind; `save`, `flushPending`, `overlayPending`, `remove` reconcile account-scoped pending work with revisions; `libraryView`, `exerciseDetailView`, `workoutForm`, `trainView`, `trendsView`, `todayView`, `youView`, `action`, and `addExercise` expose the catalog and sessions.
- `api/consumer.py`: `handle` accepts `kind` on GET, returns revisions, rejects stale workout/favorite/care writes with 409, and validates canonical exercise/set fields. `/api/consumer?kind=...&offset=...` works in both `server.py` and `api/index.py`.
- `supabase/migrations/202610190002_consumer_records.sql`: revision column and account-owned favorite/custom-exercise kinds. **Not applied to the live database.**
- `tools/migrate_owner_to_consumer.py`: dry-run-first, deterministic IDs, insert-only owner history migration; no live migration was run.
- `tools/import_exercise_media.py`: exact-map free-still import and 370-ID coverage report; runtime lookup is `public/exercise-media.js`.

## Verification performed

Run `.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v` and `.venv/bin/python -m unittest tests.browser_smoke -v`. Browser tests require Playwright and Chrome or Playwright Chromium; `WELLFRAME_CHROME_PATH` overrides the browser executable. `WELLFRAME_SCREENSHOT_DIR=docs/screenshots` writes synthetic phone screenshots. The checks cover catalog pagination/search including RC10, account-scoped favorites/custom exercises/sessions in the local adapter, three sets/reload/finish, exercise-specific recorded progress, Imperial display and interest restoration, >300 samples not hiding profile or active workout, stale revision rejection, offline reload and later successful edit, and migration repeatability. They do not prove live Supabase RLS, cross-device conflict handling, hardware sync or production readiness.

## Remaining release gates

1. Back up the actual remote owner document and apply/verify SQL migrations. The available local `data/personal.json` has **0** gym sessions; no owner history was migrated. Use a real exported owner document, run the migration dry-run, then test apply/repeat/rollback with counts before production.
2. Complete a live two-account Supabase signup/RLS/export/deletion test. Current local-mode tests do not substitute for this. Rotate the previously exposed secret and review Git history.
3. Finish training UX: richer routine prescriptions (current routines save exercise lists only), deeper exercise progress comparisons, more robust multi-device conflicts, exact source freshness and broader metrics. Sets can be reordered within their exercise group, but cross-exercise group rearrangement is not available. The timestamp-based rest timer works locally, but background device behavior is not hardware-verified. Browser local storage is unencrypted and quota-limited; pending work must sync before sign-out.
4. Obtain qualified technique review for the 20 still mappings, expand exact coverage, and license/test at least one real motion clip. No video is currently available; native media components are not connected.
5. Complete care notification scheduling, native Today/Train/Trends/Care/You journeys, actual HealthKit/Health Connect device tests, signing and store review. No native device build was completed here.

