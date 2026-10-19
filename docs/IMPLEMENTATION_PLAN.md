# CF_and_Quant implementation plan

## Baseline

- Vanilla HTML/CSS/JavaScript frontend with a Python `http.server` local server.
- Vercel rewrites `/api/*` to `api/index.py`.
- Supabase REST is currently used through the `tracker_documents` JSON document.
- Existing gym plans/sessions and the newer set-level gym tracker are both retained.
- `data/personal.json` is legacy local state and must not be the production source of truth.
- No npm build pipeline, native iOS target, or automated browser suite exists at baseline.

## Controlled phases

1. **Security and baseline:** enforce authenticated API access, remove unconditional authorization, restrict secrets, add request validation, and document the current data formats.
2. **Relational persistence:** add ordered Supabase migrations for profiles, exercises, workouts, sets, health samples/workouts, targets, nutrition, and sync state; write an idempotent migration report before retiring legacy JSON storage.
3. **Gym:** migrate `gymExerciseSessions` into relational records while preserving stable exercise IDs, then move gym reads/writes from whole-document updates to transaction-safe endpoints.
4. **Health:** add authenticated activity, recovery, sleep, body, nutrition, goal, history, and deterministic insight APIs using source-attributed records.
5. **iOS companion:** create a SwiftUI HealthKit companion with explicit permissions, Keychain-backed auth, anchored sync, retry state, and a documented physical-device verification checklist.
6. **Refinement and deployment:** consolidate health-first navigation, remove only verified generated artifacts, add tests, apply migrations, verify Vercel Preview, and document production setup.

## Safety rules

- Never reset or overwrite the working tree.
- Back up and count legacy records before migration.
- Keep legacy JSON readable until relational migration verification succeeds.
- Do not claim HealthKit or Vercel deployment is complete without real-device or deployment evidence.
