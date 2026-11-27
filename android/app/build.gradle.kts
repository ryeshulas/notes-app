plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// App version comes from android/VERSION (e.g. 1.2.3 -> versionCode 10203).
val appVersion = rootProject.file("VERSION").readText().trim()
val appVersionCode = appVersion.split(".").map { it.toInt() }.let { (a, b, c) -> a * 10000 + b * 100 + c }

// Release signing: a keystore passed in through environment variables (GitHub Actions secrets).
val keystorePath: String? = System.getenv("NOTES_KEYSTORE")?.takeIf { it.isNotBlank() }
val keystorePassword: String? = System.getenv("NOTES_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }

android {
    namespace = "com.ryeshulas.notes"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ryeshulas.notes"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
        buildConfigField("String", "GITHUB_REPO", "\"ryeshulas/notes-app\"")
    }

    signingConfigs {
        if (keystorePath != null && keystorePassword != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                keyAlias = "notes"
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.google.mlkit:digital-ink-recognition:18.1.0")
}
