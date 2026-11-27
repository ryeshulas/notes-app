package com.ryeshulas.notes

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

/** Looks for a newer APK in the GitHub releases (tags named android-vX.Y.Z) and offers to download it. */
object UpdateCheck {
    private const val EVERY_MS = 12L * 60 * 60 * 1000

    fun maybeCheck(act: MainActivity, manual: Boolean) {
        val now = System.currentTimeMillis()
        if (!manual && now - Prefs.lastUpdateCheck(act) < EVERY_MS) return
        Thread {
            try {
                val conn = URL("https://api.github.com/repos/${BuildConfig.GITHUB_REPO}/releases?per_page=20").openConnection() as HttpURLConnection
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                Prefs.setLastUpdateCheck(act, now)
                val releases = JSONArray(body)
                var best: Pair<String, String>? = null   // version, apk url
                for (k in 0 until releases.length()) {
                    val r = releases.getJSONObject(k)
                    if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue
                    val tag = r.optString("tag_name")
                    if (!tag.startsWith("android-v")) continue
                    val ver = tag.removePrefix("android-v")
                    val assets = r.optJSONArray("assets") ?: continue
                    var apk: String? = null
                    for (a in 0 until assets.length()) {
                        val asset = assets.getJSONObject(a)
                        if (asset.optString("name").endsWith(".apk")) apk = asset.optString("browser_download_url")
                    }
                    if (apk == null) continue
                    if (best == null || newer(ver, best.first)) best = ver to apk
                }
                val found = best
                act.runOnUiThread {
                    if (found != null && newer(found.first, BuildConfig.VERSION_NAME)) {
                        AlertDialog.Builder(act)
                            .setTitle("Update available")
                            .setMessage("Notes app ${found.first} is available (you have ${BuildConfig.VERSION_NAME}). Download and install it now?")
                            .setPositiveButton("Download") { _, _ -> act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(found.second))) }
                            .setNegativeButton("Later", null)
                            .show()
                    } else if (manual) {
                        Toast.makeText(act, "The app is up to date (${BuildConfig.VERSION_NAME})", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                if (manual) act.runOnUiThread { Toast.makeText(act, "Couldn't check for updates: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    /** true if version a is newer than b (e.g. 1.2.0 > 1.1.9) */
    fun newer(a: String, b: String): Boolean {
        val x = a.split(".").map { it.toIntOrNull() ?: 0 }
        val y = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (k in 0 until maxOf(x.size, y.size)) {
            val d = x.getOrElse(k) { 0 } - y.getOrElse(k) { 0 }
            if (d != 0) return d > 0
        }
        return false
    }
}
