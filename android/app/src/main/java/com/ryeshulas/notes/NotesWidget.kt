package com.ryeshulas.notes

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray

/** Home screen widget: New note / Write buttons and the most recent notes. */
class NotesWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, build(ctx))
    }

    companion object {
        private val ROWS = intArrayOf(R.id.row0, R.id.row1, R.id.row2, R.id.row3, R.id.row4)

        fun refreshAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, NotesWidget::class.java))
            for (id in ids) mgr.updateAppWidget(id, build(ctx))
        }

        fun openIntent(ctx: Context, kind: String, noteId: String? = null, code: Int): PendingIntent {
            val i = Intent(ctx, MainActivity::class.java)
                .setData(Uri.parse("notes://$kind/${noteId ?: ""}"))
                .putExtra(MainActivity.EXTRA_KIND, kind)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (noteId != null) i.putExtra(MainActivity.EXTRA_NOTE_ID, noteId)
            return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun build(ctx: Context): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            v.setOnClickPendingIntent(R.id.w_title, openIntent(ctx, "home", null, 1))
            v.setOnClickPendingIntent(R.id.w_new, openIntent(ctx, "new", null, 2))
            v.setOnClickPendingIntent(R.id.w_write, openIntent(ctx, "write", null, 3))
            val list = try { JSONArray(Prefs.recent(ctx)) } catch (e: Exception) { JSONArray() }
            for ((k, row) in ROWS.withIndex()) {
                if (k < list.length()) {
                    val n = list.getJSONObject(k)
                    val title = n.optString("title").ifBlank { "Untitled" }
                    val snip = n.optString("snip")
                    v.setTextViewText(row, if (snip.isBlank()) title else "$title  ·  $snip")
                    v.setViewVisibility(row, View.VISIBLE)
                    v.setOnClickPendingIntent(row, openIntent(ctx, "open", n.optString("id"), 10 + k))
                } else {
                    v.setViewVisibility(row, View.GONE)
                }
            }
            v.setViewVisibility(R.id.w_empty, if (list.length() == 0) View.VISIBLE else View.GONE)
            return v
        }
    }
}
