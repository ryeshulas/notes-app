package com.ryeshulas.notes

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray

/**
 * Note reminders. The web app hands over the list of upcoming reminders ({id, title, at}); each one is an
 * alarm that shows a notification at that time, even when the app is closed. Alarms are set again after
 * the phone restarts.
 */
object Reminders {
    private const val CHANNEL = "reminders"
    private const val PREFS_LIST = "reminders"
    private const val PREFS_IDS = "reminder_ids"

    fun schedule(ctx: Context, json: String) {
        val p = ctx.getSharedPreferences("notes", Context.MODE_PRIVATE)
        p.edit().putString(PREFS_LIST, json).apply()
        apply(ctx)
    }

    /** (Re)create the alarms from the saved list. */
    fun apply(ctx: Context) {
        val p = ctx.getSharedPreferences("notes", Context.MODE_PRIVATE)
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // cancel the old ones
        for (id in p.getStringSet(PREFS_IDS, emptySet()) ?: emptySet()) am.cancel(pending(ctx, id, ""))
        val list = try { JSONArray(p.getString(PREFS_LIST, "[]")) } catch (e: Exception) { JSONArray() }
        val ids = mutableSetOf<String>()
        val now = System.currentTimeMillis()
        for (k in 0 until list.length()) {
            val r = list.getJSONObject(k)
            val id = r.optString("id")
            val at = r.optLong("at")
            if (id.isEmpty() || at <= now) continue
            val pi = pending(ctx, id, r.optString("title", "Note"))
            val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            ids.add(id)
        }
        p.edit().putStringSet(PREFS_IDS, ids).apply()
    }

    private fun pending(ctx: Context, id: String, title: String): PendingIntent {
        val i = Intent(ctx, ReminderReceiver::class.java)
            .setAction("com.ryeshulas.notes.REMIND")
            .setData(Uri.parse("notes-remind://$id"))
            .putExtra("id", id)
            .putExtra("title", title)
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun notify(ctx: Context, id: String, title: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Note reminders", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Reminders you set on notes" })
        }
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle("⏰ $title")
            .setContentText("Reminder - tap to open the note")
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(NotesWidget.openIntent(ctx, "open", id, 1000 + (id.hashCode() and 0xffff)))
            .build()
        nm.notify(id.hashCode(), n)
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        Reminders.notify(ctx, id, intent.getStringExtra("title") ?: "Note")
    }
}

/** Alarms are cleared when the phone restarts, so set them again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) Reminders.apply(ctx)
    }
}
