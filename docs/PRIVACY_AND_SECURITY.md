# Privacy and security

Core API routes require an authenticated Supabase access token. The only local exception is `ALLOW_LOCAL_DEV_AUTH=1` with no Authorization header; it is ignored in production. Consumer data ownership is derived from the verified token subject, never from a browser-supplied owner ID. The older shared personal document is accessible only to `SUPABASE_OWNER_USER_ID`.

Keep `SUPABASE_SERVICE_ROLE_KEY`, secret keys, JWT verification configuration, and HealthKit sync credentials server-side. The browser may use a Supabase publishable key for Auth, but must never receive a database secret.

Consumer pending writes are held in tab-scoped `sessionStorage`, without encryption, and retried on reconnect. Sign-out clears them. Closing the tab before sync may lose them. The consumer API returns only a page of 300 records on initial load; export fetches all pages. Legacy behavior and records are described separately in the README.

`data/personal.json` is ignored and removed from the Git index while remaining on disk. Old commits may still expose it. The previously exposed server credential needs rotation. This repository does not yet have a production privacy policy, native permission disclosures, verified store declarations, or complete HealthKit/Health Connect deletion semantics.
