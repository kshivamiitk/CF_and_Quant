# Data migration strategy

The legacy personal document is preserved until a migration has been run and verified. The migration must be idempotent and should record counts only, never personal values.

## Legacy sources

- `personal.gymExerciseSessions`: set-level sessions from the current gym tracker.
- `personal.gymPlans` and `personal.gymSessions`: older planned/executed workouts.
- `personal.healthImports`: shortcut daily summaries.
- Other personal collections remain in `tracker_documents` during the transition.

## Verification requirements

1. Export a backup of the current document.
2. Count sessions, sets, health summaries, and source identifiers.
3. Upsert relational rows using stable IDs and source keys.
4. Re-run safely without increasing counts.
5. Compare counts and representative relationships.
6. Keep the legacy document until the report has no errors.

No destructive migration has been run by this implementation phase.
