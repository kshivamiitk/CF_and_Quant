# Vercel deployment

## Required server variables

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` or the current Supabase server secret
- `SUPABASE_JWKS_URL`
- `SUPABASE_AUTH_ISSUER`
- `SUPABASE_AUTH_AUDIENCE=authenticated`
- `SUPABASE_OWNER_USER_ID` (the existing owner's Supabase Auth UUID; grants access to the private legacy workspace)
- `APP_BASE_URL`
- Existing push variables when reminders are enabled

Set `ALLOW_LOCAL_DEV_AUTH=0` and `CONSUMER_LOCAL_MODE=0` or omit them in Vercel. Never upload `.env` and never place a service-role/secret key in `public/`.

## Safe order

1. Keep the existing private owner user and enable email signups only when the new consumer migration and privacy review are ready. Configure Auth redirect URLs for Preview and production.
2. Apply `supabase/schema.sql`, then the ordered migrations under `supabase/migrations/`.
3. Configure the variables above in Vercel Preview first.
4. Verify anonymous `/api/auth/config` returns `200` with a nonempty `url` and `publishableKey`. The catch-all rewrite carries the original route as `__wellframe_route`; without it, the Python handler sees `/api/index.py` and incorrectly returns `401` before login can start. Do not put the server secret in this public config response.
5. Verify anonymous `/api/auth/me`, `/api/personal` and `/api/consumer` return `401`, and a signed-in new user receives `403` for `/api/personal`.
6. Sign in through the browser with separate owner and new-user accounts; verify isolated consumer read/write and RLS.
7. Run the data migration and verify counts before production promotion.

The repository has not been declared deployed by this change; a successful Vercel deployment and Preview smoke test still require the account's Vercel credentials.
