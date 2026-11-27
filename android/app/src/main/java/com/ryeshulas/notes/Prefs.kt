package com.ryeshulas.notes

import android.content.Context
import android.content.SharedPreferences

/** Small settings store: the server address, the widget's recent notes, update-check time. */
object Prefs {
    private fun p(ctx: Context): SharedPreferences = ctx.getSharedPreferences("notes", Context.MODE_PRIVATE)

    fun serverUrl(ctx: Context): String? = p(ctx).getString("server_url", null)
    fun setServerUrl(ctx: Context, url: String) = p(ctx).edit().putString("server_url", url).apply()

    /** JSON array of {id, title, snip} for the widget. */
    fun recent(ctx: Context): String = p(ctx).getString("recent", "[]") ?: "[]"
    fun setRecent(ctx: Context, json: String) = p(ctx).edit().putString("recent", json).apply()

    fun lastUpdateCheck(ctx: Context): Long = p(ctx).getLong("last_update_check", 0)
    fun setLastUpdateCheck(ctx: Context, t: Long) = p(ctx).edit().putLong("last_update_check", t).apply()

    /** Normalise what the user typed into a base URL like https://notes.example.com */
    fun normalise(input: String): String? {
        var s = input.trim().trimEnd('/')
        if (s.isEmpty()) return null
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
        return try {
            val u = android.net.Uri.parse(s)
            if (u.host.isNullOrBlank()) null else "${u.scheme}://${u.authority}"
        } catch (e: Exception) { null }
    }
}
