# Kumar Quant Tracker

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

Enter your Codeforces handle in the header and press `Sync` to update problem status from your submissions. Accepted submissions mark problems `Done`; attempted problems without an accepted submission are marked `Doing`.

The Contests tab tracks upcoming Codeforces and CodeChef contests. The tracker polls every 10 minutes, shows a red or amber emergency banner for live/near contests, and can send browser notifications after you press `Notify` and grant permission.

Progress is stored in:

```text
data/progress.json
```

Quant progress is stored in:

```text
data/quant_progress.json
```

Schedule and notes are stored in:

```text
data/personal.json
```

The app is installable as a PWA from supported browsers. On iPhone, open the app URL in Safari and use Share -> Add to Home Screen. For a reliable installable PWA outside localhost, serve it over HTTPS.

## Private phone access

For access from your phone on the same network, run on all interfaces with a private token:

```bash
python3 server.py --host 0.0.0.0 --port 8765 --token "choose-a-long-private-token"
```

Find your Mac's local IP address, then open this once on the phone:

```text
http://YOUR_MAC_IP:8765/?token=choose-a-long-private-token
```

The app stores the token in the browser and sends it with API requests. Without `--token`, do not expose the server outside your own machine.

## Apple distribution

This repo is now an installable private web app, not a submitted native iOS binary. To distribute through Apple, wrap this frontend/backend model in a native iOS shell or hosted service, then use one of Apple's private distribution routes:

- Unlisted App Distribution: https://developer.apple.com/support/unlisted-app-distribution/
- Custom Apps with Apple Business/School Manager: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods/
- TestFlight for private beta installs: https://developer.apple.com/testflight/

## Deploy on Vercel

The project is Vercel-friendly now:

- `public/` is served as the static PWA frontend.
- `api/index.py` is the Vercel Python Function for all `/api/...` routes.
- `vercel.json` rewrites `/api/*` to that function.
- Mutable state uses Upstash Redis over REST when these env vars are configured:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
  - `TRACKER_STORAGE_PREFIX`

Without Upstash env vars, the API falls back to local JSON files. That is useful locally, but not reliable for production Vercel persistence.

### 1. Create storage

In Vercel:

1. Open your Vercel dashboard.
2. Create or open the project.
3. Go to Storage/Marketplace.
4. Add Upstash Redis.
5. Copy the REST URL and REST token into project environment variables:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
TRACKER_STORAGE_PREFIX=kumar_quant
REQUIRE_TRACKER_TOKEN=0
```

Token auth is disabled by default for easier iPhone use. If you later want token auth, set `REQUIRE_TRACKER_TOKEN=1` and add `TRACKER_PRIVATE_TOKEN`.

### 2. Deploy

From this folder:

```bash
npm i -g vercel
vercel login
vercel
```

For production:

```bash
vercel --prod
```

### 3. Open the app

Open the production URL:

```text
https://YOUR-PROJECT.vercel.app/
```

If you enabled token auth with `REQUIRE_TRACKER_TOKEN=1`, open it once as `https://YOUR-PROJECT.vercel.app/?token=YOUR_TRACKER_PRIVATE_TOKEN`.

### 4. Install on iPhone

1. Open the Vercel URL in Safari on iPhone.
2. Confirm the app loads.
3. Tap Share.
4. Tap Add to Home Screen.
5. Name it `Kumar Quant`.
6. Tap Add.

After that it opens like an app from your Home Screen.

### 5. Enable calendar reminders

The Home Screen app supports Web Push on iOS 16.4 or later. Generate one VAPID
key pair:

```bash
npx web-push generate-vapid-keys --json
```

Add these Production environment variables in Vercel:

- `APP_BASE_URL=https://YOUR-PROJECT.vercel.app`
- `VAPID_PUBLIC_KEY` from the generated public key
- `VAPID_PRIVATE_KEY` from the generated private key
- `VAPID_SUBJECT=mailto:YOUR_EMAIL`
- `QSTASH_TOKEN` from the Upstash QStash dashboard
- `REMINDER_DISPATCH_SECRET` set to a long random value

Redeploy, launch the installed iPhone app, open Calendar, and tap **Enable
reminders**. The app creates one QStash minute schedule and sends a test
notification immediately.

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
