plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "com.example.wellframe"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.example.wellframe"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
        buildConfigField("String", "API_BASE_URL", "\"https://your-deployment.example\"")
        buildConfigField("String", "SUPABASE_URL", "\"https://your-project.supabase.co\"")
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"your-publishable-key\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
