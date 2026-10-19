# iPhone HealthKit companion setup

Source is in `native/ios/`. It is an iOS 17+ SwiftUI companion with selected steps, active energy and heart-rate reads. It requests HealthKit access only after explanation and separate cloud-upload consent. Anchored queries include additions and deletions; the anchor advances after server acknowledgment. Uploads use stable HealthKit UUIDs and retry transient failures. The web/PWA does not read HealthKit directly. Background delivery is not enabled; foreground manual sync is the implemented path.

This machine has Swift command-line tools but **not Xcode**. `swiftc -frontend -parse` succeeded; compiling, signing, installing, and testing on an iPhone/Apple Watch remain unverified. The source is not an App Store build.

## Required setup on a Mac with Xcode

1. Install current Xcode and XcodeGen. Choose an Apple Developer team with HealthKit capability available. Use a unique bundle ID.
2. Replace `com.example.wellframe` and the placeholder `APIBaseURL`, `SupabaseURL`, and `SupabasePublishableKey` in `native/ios/project.yml`. Use HTTPS. The publishable key may be in the app; never add a secret/service key.
3. In Supabase, apply the ordered migrations, configure email sign-in, and allow the deployed website's Auth redirect URL. Sign in to the companion with a verified account.
4. From `native/ios`, run `xcodegen generate`. Open `Wellframe.xcodeproj` in Xcode, select the real team, and confirm the generated `com.apple.developer.healthkit` entitlement and `NSHealthShareUsageDescription` on the app target.
5. Build to an iPhone, not just a simulator. In the companion, select only desired metric types, enable cloud upload, and request access. Denial or no records should remain a neutral state. Verify a known measurement's time, unit, source and stable ID on the web Trends page.
6. Pair an Apple Watch, record a real measurement, and manually sync again. Delete or correct a sample in Apple Health and verify the corresponding server tombstone/update. Repeat with the device offline and after app restart. Verify no duplicate on retry.
7. Check Sign out/Disconnect, revoke HealthKit permission in iPhone Settings, then use the web's imported-data removal if cloud copies should be deleted. Confirm records are absent after removal.

Apple may limit or delay data availability and background delivery. The app does not claim continuous or instantaneous sync. HealthKit does not reveal whether read permission was denied or there are simply no readable samples. Current code does not read sleep stages, workouts, HRV or routes and does not schedule medication notifications.

Official references: [HealthKit setup](https://developer.apple.com/documentation/healthkit/setting-up-healthkit), [authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data), [anchored queries](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery), [App Review](https://developer.apple.com/app-store/review/guidelines/).
