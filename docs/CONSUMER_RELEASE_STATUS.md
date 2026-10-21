# Wellframe consumer slice — implementation and release status

Wellframe is a working name. This document records what the code does as of 2026-10-21; it is not a store-readiness claim.

## Repository audit and UX decisions

Entry points are `public/index.html`/`app.js`, `server.py` locally, and `api/index.py` on Vercel. The original app contains Today, Schedule, Gym, Wellness, Focus, Notes, and hidden Insights/Life views. Its legacy state is one `tracker_documents` JSON document under a fixed owner ID. The newer gym tracker also stores sessions in that document. The old `data/personal.json` file was tracked by Git; it is now ignored and removed from the index without deleting the local copy. Past commits still need a separate history review. The app had no browser test before this slice. The old login gate's CSS overrode `[hidden]`, which explains why the form persisted after sign-in; a global `[hidden]` rule now fixes that.

The consumer navigation is Today → Train → Trends → Care → You. Train now exposes the full 370-ID catalog to every account, separate from the configured owner's private planner/notes/quant workspace. Fresh accounts never request `/api/personal`, and `/api/personal` rejects other verified users. Returning users skip setup; the manual mode is immediately useful without wearable access. Profile interests are optional. No fabricated health measurements are shown.

The visual system is in `public/consumer.css`: light canvas `#F5F7F9`, dark canvas `#0D141B`, teal activity accent, warm focus ring, 8–32 px spacing, 13/22/24 px control/card radii, and labeled five-item navigation. Exercise cards and video-play controls have short hover/press feedback; reduced motion removes it. Chrome screenshots and horizontal-overflow checks were reviewed at 390×844 and 1280×900 CSS pixels. This is a viewport check, not real-device accessibility certification.

## Implemented

- Supabase email sign-in, signup, confirmation pending message/resend, reset-link request and new-password return, session refresh, sign-out, and password visibility. Provider buttons are absent because no Apple/Google provider has been configured.
- Verified token subject drives the consumer account ID. The existing private legacy document is restricted to `SUPABASE_OWNER_USER_ID`. Explicit local bypass is disabled in production and only applies with no Authorization header.
- `consumer_records` stores separate RLS-protected, account-owned records for profile preferences, manual workouts, favorites, custom exercises, water, care items, check-ins and source-attributed device samples. Non-sample writes use a revision precondition to reject stale edits; scheduled care occurrences derive their ID on the server. Kind-scoped reads prevent health-sample volume from hiding profile or active workouts. The earlier migration also contains typed tables that are not yet connected to this slice.
- Today has real weekly workout count, manual water totals and resume action. Train exposes all 370 exercises with search/category/show-more, account-owned favorites/custom entries, grouped sets with stable IDs, automatic save, timestamp-based rest timer, resume, finish summary, completed-session correction and reuse. One hundred exact-match exercise IDs have imported still thumbnails, 92 with paired poses. Four IDs have click-to-load YouTube previews from three distinct movement videos; all others have a clearly labeled unreviewed search link. No motion files are bundled and no qualified technique approvals are claimed. Trends now has recorded working-set/load-volume bars and hydration bars, with accessible tables; it is not yet a full metric explorer. Care supports user-entered items, a daily time, edit/pause/remove, taken/skipped check-ins, undo, and history. The daily time is displayed only; this web slice does **not** schedule medication notifications.
- Pending writes and a non-sample snapshot now stay in this browser's account-scoped `localStorage`, restore after offline reload and retry on reconnect. It is **not encrypted**; shared-device users must wait for sync before signing out, which clears the local copy after confirmation. A successful newer save supersedes stale pending work, and server revision checks reject conflicting replay. Export pages through all consumer records. A user can remove imported device samples separately. Deletion is implemented for new consumer accounts through Supabase Auth Admin and database cascade; the legacy owner is blocked pending cleanup of old tables.
- Source projects now exist under `native/ios` and `native/android`: selected HealthKit steps/active energy/heart rate with anchored query upload, and Health Connect steps with changes-token upload. Both include deletion markers and account-scoped credential storage. Native builds and device behavior are **unverified** on this machine.

## Setup and migration

1. Back up the Supabase project and count existing rows. Do not overwrite or delete `tracker_documents`. Keep the local `data/personal.json` backup.
2. In Supabase SQL Editor, apply `supabase/schema.sql`, then `202610190001_health_fitness_core.sql`, then `202610190002_consumer_records.sql`. These files create tables and policies without deleting old rows. This run did **not** apply them to the remote project.
3. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`, `SUPABASE_AUTH_ISSUER`, and `SUPABASE_AUTH_AUDIENCE=authenticated` on the server. `SUPABASE_OWNER_USER_ID` grants legacy workspace access to only that existing account. `ALLOW_LOCAL_DEV_AUTH=0` in deployment. Enable email signup/confirmation and allow-list the exact site and localhost callback URLs in Supabase Auth.
4. Create `.venv` and install `requirements.txt`; run `.venv/bin/python server.py --port 8765`. For authenticated localhost work before the migration is applied, set `CONSUMER_LOCAL_MODE=1`; data goes to separate per-account local files and the UI labels it local development. To see a fresh mock account without Supabase credentials, run with `ALLOW_LOCAL_DEV_AUTH=1 SUPABASE_OWNER_USER_ID=''`. Neither local setting may be deployed. `CONSUMER_LOCAL_DATA_DIR` can point at a disposable directory for QA.
5. Verify new-user signup, confirmation, owner versus non-owner access, RLS, export and account deletion in a Vercel Preview before production. Those live checks are still open.

## Privacy and release limits

The web app sends account email/password to Supabase Auth, and health records to Supabase Postgres only after the user enters them or explicitly consents to native cloud upload. The browser's tab-scoped session holds auth tokens and pending entries. Static PWA assets are cached; `/api/` responses are not. YouTube is loaded only after a tap on a matched preview and may collect playback data; its requests are not cached by our service worker. No advertising or health analytics SDK was added. Consumer records remain until the user deletes them; no automatic retention limit is implemented. Browser notification delivery for care is absent. Native source code exists, but there is no signed build, real HealthKit/Apple Watch/Health Connect sync evidence, or physical-device verification. Manual Shortcut imports in the legacy owner workspace are not automatic wearable sync. Do not advertise this build as reading device health data or as approved for either store yet.

The previously exposed Supabase server key should be rotated. Old Git commits may contain credentials or personal data even though current `.env` and `data/personal.json` are ignored. History rewriting would affect collaborators and was not performed.

## Verification evidence and acceptance checklist

Reference environment: macOS with Chrome headless, local loopback, 390×844 and 1280×900 CSS viewports, reduced motion in browser smoke. Network performance, INP/LCP/CLS and real-device behavior were not measured. See `FITNESS_FEATURE_PRESERVATION.md`, `EXERCISE_MEDIA_SOURCES.md` and `EXERCISE_MEDIA_COVERAGE.md` for the corrective pass.

| Scenario | Evidence/status |
| --- | --- |
| 1. New account reaches useful home without wearable | Manual-mode browser flow passed with isolated local account; real Supabase signup/verification blocked pending live configuration test. |
| 2. Selective Apple Health/Health Connect connection | Partial: native source paths exist; device build, permission and upload checks blocked pending Xcode/Android SDK, signing and hardware. |
| 3. No readable wearable records; manual workout | Passed in local browser flow. |
| 4. Three sets, edit, background/resume, finish | Partial: three-set edit, reload/resume, finish and correction passed; actual background interruption on a physical device not tested. |
| 5. Trends period, chart, gaps | Partial: 7/30-day switch and table passed; interactive scrubbing not implemented. |
| 6. Supplement reminder, log, undo, edit | Partial: item, log, undo, edit implemented; notifications not scheduled. |
| 7. Notification permission decline/enable | Blocked: care notification implementation absent. |
| 8. Returning home and unfinished workout | Browser reload/resume passed; mocked Supabase sign-in and restored-session browser test confirms the login form stays hidden. A live Supabase session is not yet verified. |
| 9. Offline save, reconnect, one record | Partial: account-scoped browser queue, reload and newer-edit replay passed under simulated network interruption; true device/network and cross-device conflict tests remain. |
| 10. User B cannot see User A | Local store unit test passed; live Supabase/RLS cross-account test pending migration. |
| 11. Accessibility modes and layouts | Partial: semantic controls, labels, reduced motion and 390 px overflow checked; screen reader, large text and real devices pending. |
| 12. Export, disconnect, deletion | Partial: paginated JSON export, imported-data removal and new-account delete code exist; live delete, native disconnect and notification cleanup not verified. |

Commands run: `.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v` (expanded suite), `.venv/bin/python -m unittest tests.browser_smoke -v` (catalog-to-session and offline replay included), `node --check` for edited JavaScript, `swiftc -frontend -parse` for the iOS source, Python compile checks, and `git diff --check`. The local server health endpoint returned 200 on port 8765. Real sign-in, physical hardware, store signing, and Vercel deployment were not used for these checks. Browser tests use the active Python interpreter and an installed Playwright Chromium, or `WELLFRAME_CHROME_PATH` when Chrome is available.

Official review references: [Apple HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data), [Apple App Review](https://developer.apple.com/app-store/review/guidelines/), [Android Health Connect UI](https://developer.android.com/health-and-fitness/health-connect/ui/guidelines), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
