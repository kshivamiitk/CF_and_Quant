# Android Health Connect companion setup

Source is in `native/android/`. The current native scope is foreground, read-only steps import for Android 9+ devices with Health Connect available. It requests only `READ_STEPS` after explicit cloud-upload choice, reads a 30-day snapshot, then uses a per-account changes token for upserts/deletions. Stable IDs make retries idempotent. Raw source samples remain separate on the web to avoid overlapping-source double counting. It does not claim that any particular watch exposes data through Health Connect.

This machine has no Android SDK, Gradle or device connected. The Android project has **not been compiled or installed**. Google Play readiness, permissions and behavior must be checked on hardware.

## Build and device steps

1. Install Android Studio, JDK 17, Android SDK 35 and compatible Gradle 8.9. The project uses Android Gradle Plugin 8.7.3, Kotlin 2.0.21 and stable Health Connect client 1.1.0. Generate a wrapper with `gradle wrapper --gradle-version 8.9` in `native/android/` if none exists, then use `./gradlew assembleDebug`.
2. Replace `com.example.wellframe` with an owned application ID. Replace the three placeholder `buildConfigField` values in `native/android/app/build.gradle.kts` with the deployed HTTPS API URL, Supabase URL and publishable key. Never put a secret key in the APK.
3. Configure Supabase email Auth and apply the SQL migrations. Install Health Connect on Android 9–13; on Android 14+ use the platform provider. In Android Settings/Health Connect, verify provider availability.
4. Install the debug build on a device. Sign in, grant only Steps permission, choose cloud upload and sync. Confirm source/time/units on the web Trends page. Revoke permission, retry, and verify a helpful error with no fabricated zero.
5. Create a real step record from a source app, sync twice and check one server record. Delete it and verify a tombstone after the next sync. Test offline interruption, app restart, token expiry/re-scan and account switching. Check 30-day history limits and Play health-data declaration before any release.

Background reads, other metrics, local medication notifications and a store-ready visual identity are not implemented in this companion. Android Health Connect data availability and permission limits vary by OS/provider.

Official references: [Get started](https://developer.android.com/health-and-fitness/health-connect/get-started), [sync data](https://developer.android.com/health-and-fitness/health-connect/sync-data), [steps permissions](https://developer.android.com/health-and-fitness/health-connect/features/steps), [UI guidance](https://developer.android.com/health-and-fitness/health-connect/ui/guidelines).
