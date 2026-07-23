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
