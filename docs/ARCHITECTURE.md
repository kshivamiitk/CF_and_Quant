# Current and target architecture

## Current

The browser renders the static app in `public/`. The health-first consumer surface calls `/api/consumer` for per-account records in `consumer_records`, with RLS and a verified token boundary; a local per-user JSON adapter supports development. The original planner/notes/gym workspace still calls `/api/personal` and `/api/health-import`, restricted to the configured legacy owner. Supabase stores that older document in `tracker_documents`; local JSON is its development fallback.

## Target

Supabase Postgres becomes the source of truth for core health and gym data. Each user-owned record is keyed by the authenticated Supabase user ID and protected by RLS. Legacy personal-document modules remain during migration, but new workout and health records use independent tables and idempotent APIs. The iOS companion reads HealthKit only after explicit authorization and uploads source-attributed records through authenticated endpoints.

## Current limitations recorded honestly

- Native companion source and project specifications now exist; they have not been built or verified on devices.
- A Playwright + Chrome browser smoke script now covers the manual web slice; there is no full browser-test pipeline.
- Existing personal-document persistence must be migrated before it can be removed.
- Real Supabase Auth credentials and an authorized user UUID are deployment setup, not repository defaults.
