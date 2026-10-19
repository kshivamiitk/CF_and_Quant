# Fitness feature preservation matrix

This inventory compares the legacy owner workspace with the account-owned Wellframe consumer surface. The owner document is never shared with new users.

| Capability | Legacy component/data | Consumer route/data | Customer status | Migration/test |
| --- | --- | --- | --- | --- |
| 370-ID exercise catalog | `public/gym-library.js`, static IDs/modes | Train → Exercise library; same file | Available to every signed-in account; search/category/show-more | Browser checks CH01 and late ID RC10; count asserted in media importer |
| Exercise detail and progress | `public/gym-progress.js`, `gymExerciseSessions` in owner document | Train → Details; account-owned `workout` records | Details and history available; progress chart still incomplete | Browser detail/media/add test; owner migration script dry-run |
| Favorites | `gymExerciseFavorites` in owner document | Train → Save, `favorite` record | Available per account | Needs live two-account/RLS test |
| Custom exercises | Legacy custom entry support in owner document | Train → Create personal exercise, `custom_exercise` | Available per account | Needs live two-account test |
| Saved routines | Legacy weekly gym plans in owner document | Train → Save as routine / Start routine, `routine` | Exercise-list routines available per account; set prescriptions not yet templated | Browser saves and starts a routine; local isolation unit test |
| Set logging | Legacy per-exercise sessions with load/reps/duration/distance/warmup | Train → Active workout, grouped `workout.sets` | Canonical IDs and stable set IDs; add/duplicate/remove; timed/distance fields; timestamp-based rest timer | Browser three-set/rest/reload/finish; server validation tests |
| Completed-session corrections | Legacy edit/delete session | Train → View / correct | Editable sets/detail; not all legacy metadata editable | Browser edits completed reps and verifies after reload |
| Legacy owner history | `data/personal.json` and remote owner document | `consumer_records` `workout` under owner ID after migration | **Not migrated in live project** | `tools/migrate_owner_to_consumer.py` insert-only dry run: local file has 0 sessions; synthetic repeatability test |
| Account-owned health samples | None in old gym view | Trends/Today, `health_sample` | Raw source values visible, not yet full aggregate explorer | 350-sample/profile/active read test |
| Owner-only planner/quant | `state.personal`, `/api/personal` | You → private workspace for configured owner only | Intentionally not visible to customers | Auth ownership tests; live two-account test pending |

The legacy data is preserved. New accounts never fetch the owner document. For a real migration, first back up the remote owner document and apply the SQL migration; run the consumer migration dry-run against an exported copy of the actual owner data. The current local `data/personal.json` contains zero gym sessions, so no live history was migrated here.

Synthetic-account phone screenshots from the browser test: [Train library](screenshots/train-library-phone.png) and [exercise detail](screenshots/exercise-detail-phone.png). They use a local test account and no personal health records.

