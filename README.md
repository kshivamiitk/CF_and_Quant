# Wellframe consumer health slice + Kumar Quant legacy workspace

The default app is a five-destination health experience (Today, Train, Trends, Care, You). Train includes the original 370-ID exercise catalog, account-owned favorites, custom exercises and simple saved routines, grouped workout sets, a rest timer, finish review, and a small licensed still-image batch. Manual workouts, water and care are account scoped; the previous Kumar planner/notes/quant workspace remains available only to the configured legacy owner from You. See [corrective pass](docs/WELLFRAME_REVIEW_PASS.md), [feature matrix](docs/FITNESS_FEATURE_PRESERVATION.md), and [consumer release status](docs/CONSUMER_RELEASE_STATUS.md). Native companion source exists, but HealthKit/Health Connect sync has not been built or verified on devices; app-store releases are not complete.

Local setup:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py --port 8765
```

Back up the Supabase project, apply `supabase/schema.sql` and then the ordered migrations in `supabase/migrations/` before using consumer records or notifications with a real Supabase account. Local development can use `ALLOW_LOCAL_DEV_AUTH=1` and a disposable `CONSUMER_LOCAL_DATA_DIR`; `CONSUMER_LOCAL_MODE=1` makes even authenticated localhost accounts use local files instead of Supabase, and must never be deployed. For tests, install Playwright and a Chromium browser, then run `.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v` and `.venv/bin/python -m unittest tests.browser_smoke -v`. The optional media importer requires Pillow (`.venv/bin/python -m pip install Pillow`); see [media sources](docs/EXERCISE_MEDIA_SOURCES.md). The remainder of this README describes the original legacy workspace and some historical deployment paths; the consumer release status takes precedence where they differ.

## Legacy workspace

Private quant interview, Codeforces, schedule, and notes tracker for Kumar Shivam.

The included roadmap has 500 Codeforces problems grouped into topic trees. It keeps a 300-problem recent base from finished public contests dated 2024-07-03 or later, then supplements extra 1700/1800/1900 drill problems from older finished contests where the recent pool is exhausted.

The app now also imports the local quant PDFs:

- `QUANT GUIDE.pdf`
- `QUANT GUIDE 2.pdf` (detected as a duplicate of `QUANT GUIDE.pdf`)
- `green-book-few pages.pdf`

The imported quant bank currently has 1,259 structured prompt/solution records in `data/quant_questions.json`.

## Run

```bash
python3 server.py --port 8765
```

Open:

```text
http://127.0.0.1:8765
```

The first screen is the Today dashboard. It assigns one quant problem at a time. The current quant problem stays locked as the active problem until you mark it solved; only then is the solution revealed and the next problem can be loaded.

Every question in the Quant table has an editable `Todo`, `Doing`, or `Done`
status. A previously completed question can be corrected later; changing it
away from `Done` removes its solved timestamp and solved-history entry.

The Brain Arcade includes a twelve-card memory matching game, a ten-question
mental-math sprint, and procedurally generated missing-number sequences. Scores,
XP, and the sequence streak are retained on the device.

Enter your Codeforces handle in the header and press `Sync` to update problem status from your submissions. Accepted submissions mark problems `Done`; attempted problems without an accepted submission are marked `Doing`.

The Contests tab tracks upcoming Codeforces and CodeChef contests. The tracker polls every 10 minutes, shows a red or amber emergency banner for live/near contests, and can send browser notifications after you press `Notify` and grant permission.

The Notes tab uses an Apple Notes-style editor with rich text, headings, lists,
checklists, links, search, pinning, and automatic saving. The focused phone
navigation contains Today, Quant, Schedule, Wellness, Notes, Contests, and roadmap views;
the former Life and Insights screens are no longer shown.

The Wellness tab stores repeatable skincare routines with ordered steps, time,
and selected weekdays. It also stores daily or weekday gym plans with workout
duration and per-exercise sets, reps, and duration. Each routine can be checked
off for the day and contributes to the daily completion indicator.

The dedicated Gym tab separates weekly plans from dated sessions. Today shows
only the current weekday’s plan, with editable actual weight, reps, duration,
and an independent checkbox for every set. Sessions can be marked present,
absent, rest, partial, or complete, and remain in Gym and Calendar history.

The Focus tab provides 25/50/90-minute timers, partial-session logging, daily and
weekly focused minutes, a seven-day chart, session history, and a consistency
rhythm. Contest `Add to my calendar` actions now create internal schedule events
instead of opening Google Calendar.

Progress is stored in:

```text
data/progress.json
```

Quant progress is stored in:

```text
data/quant_progress.json
```

Schedule, notes, tasks, goals, habits, health, career records, financial data,
focus sessions, and expenses are stored in:

```text
data/personal.json
```

The app is installable as a PWA from supported browsers. On iPhone, open the app URL in Safari and use Share -> Add to Home Screen. For a reliable installable PWA outside localhost, serve it over HTTPS.

The installed iPhone icon uses the supported app badge to show the number of
days remaining in the year. iOS keeps Home Screen icon artwork static for web
apps, so the app also shows the live countdown inside the header icon mark.

## Private phone access

Use the HTTPS Vercel deployment with Supabase email sign-in for phone access. The older `--token` argument is not the consumer API authentication mechanism; do not expose the local development bypass on a network interface.

## Apple distribution

This repository has an installable web app, not a submitted native iOS binary. HealthKit and Apple Watch access require a native companion; see [the current setup status](docs/APPLE_HEALTHKIT_SETUP.md). Possible future distribution routes include:

- Unlisted App Distribution: https://developer.apple.com/support/unlisted-app-distribution/
- Custom Apps with Apple Business/School Manager: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods/
- TestFlight for private beta installs: https://developer.apple.com/testflight/

## Deploy on Vercel

Use [the current Vercel deployment guide](docs/VERCEL_DEPLOYMENT.md). Supabase is required for authenticated consumer records in production. The old Upstash/token-only instructions were removed because they no longer describe the app's security boundary.

### Legacy calendar reminders

The Home Screen app supports Web Push on iOS 16.4 or later. Generate one VAPID
key pair:

```bash
npx web-push generate-vapid-keys --json
```

Add these Production environment variables in Vercel:

- `SUPABASE_URL` from Supabase Project Settings
- `SUPABASE_PUBLISHABLE_KEY` for browser sign-in
- `SUPABASE_SERVICE_ROLE_KEY` or server-only Supabase secret in Vercel
- `SUPABASE_OWNER_USER_ID` set to the private Supabase Auth user's UUID
- `SUPABASE_AUTH_ISSUER=https://YOUR-PROJECT.supabase.co/auth/v1`
- `SUPABASE_AUTH_AUDIENCE=authenticated`

- `APP_BASE_URL=https://YOUR-PROJECT.vercel.app`
- `VAPID_PUBLIC_KEY` from the generated public key
- `VAPID_PRIVATE_KEY` from the generated private key
- `VAPID_SUBJECT=mailto:YOUR_EMAIL`
- `QSTASH_TOKEN` from the Upstash QStash dashboard
- `REMINDER_DISPATCH_SECRET` set to a long random value
- `APP_TIMEZONE=Asia/Kolkata` (optional; this is the default)

Before the first Supabase-backed deployment, open the Supabase SQL Editor and
run [`supabase/schema.sql`](supabase/schema.sql), followed by the ordered
migrations in [`supabase/migrations/`](supabase/migrations/). Production API
requests require Supabase Auth; local-only bypass is controlled by
`ALLOW_LOCAL_DEV_AUTH=1` and must never be enabled in Vercel. See the focused
guides in [`docs/`](docs/).

Redeploy, launch the installed iPhone app, open Calendar, and tap **Enable
reminders**. The app creates one QStash minute schedule and sends a test
notification immediately. The same minute dispatcher sends event reminders, a
morning summary of calendar work/contests/practice, and contest alerts at
24 hours, 1 hour, 15 minutes, and live. A delayed scheduler run can catch up a
missed event reminder for six hours. Unfinished calendar work is repeated every
two hours from 9 AM to 10 PM on its scheduled day, until you press `Done`; the
active unsolved quant problem is repeated every three hours in that window.
Skincare and gym reminders fire at their selected local time, retry within a
45-minute catch-up window, and nudge every two hours until completed for the day.

Bank CSV import accepts the columns `Date`, `Description`, `Amount`, `Category`,
and `Type`. Set `Type` to `income` or `credit` for inflows. Imported rows are
deduplicated on date, description, and amount.

The roadmap is stored in:

```text
data/roadmap.json
```

Upcoming contest cache is stored in:

```text
data/contest_cache.json
```

Regenerate the recent-problem roadmap with:

```bash
python3 tools/build_recent_roadmap.py
```

The Desktop launcher `CF 2000 Tracker.app` starts the server if needed and opens the tracker in your browser. Rebuild the colorful macOS icon and launcher with:

```bash
python3 tools/install_desktop_launcher.py
```


## Desktop companion

Open the new fun hover dashboard at:

```text
http://127.0.0.1:8765/desktop.html
```

The big CF icon shows a popover on hover with today's roadmap targets, upcoming contest alerts, and the current pace needed to reach 2000. Press `Enable notifications` once to allow browser desktop notifications for the day's targets and urgent contests.

The companion uses a new local endpoint:

```text
/api/today
```

It computes the next unlocked problems from `data/roadmap.json` + `data/progress.json`, prioritizes problems already marked `Doing`, then fills the rest with unlocked `Todo` problems. Contest alerts are pulled from the existing contest radar/cache.

On macOS, rebuild the desktop launchers with:

```bash
python3 tools/install_desktop_launcher.py
```

This installs two Desktop apps:

- `CF 2000 Tracker.app` — opens the full tracker.
- `CF 2000 Today.app` — opens the hover/notification companion.

Note: macOS Finder does not allow a normal Desktop icon hover tooltip to be dynamically filled by a Python app. So this package gives you the closest reliable version: a dedicated desktop companion page with a hover icon and real browser desktop notifications.
