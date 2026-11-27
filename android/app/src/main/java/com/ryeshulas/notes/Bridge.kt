package com.ryeshulas.notes

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject
import java.io.File

/** Functions the web app can call as window.NotesAndroid.* */
class Bridge(private val act: MainActivity) {

    @JavascriptInterface fun appVersion(): String = BuildConfig.VERSION_NAME

    /** The pending widget/tile/share action as JSON (or ""), cleared once read. */
    @JavascriptInterface fun takeAction(): String {
        val a = act.pendingAction ?: return ""
        act.pendingAction = null
        return a
    }

    @JavascriptInterface fun takeShared(): String {
        val s = act.pendingShare ?: return ""
        act.pendingShare = null
        return s
    }

    /** lines: JSON array of lines, each an array of strokes, each a flat [x, y, x, y, ...] array. */
    @JavascriptInterface fun recognize(lines: String, callbackId: String) {
        Handwriting.recognize(
            lines,
            status = { st -> callback(callbackId, JSONObject().put("status", st)) },
            done = { result -> callback(callbackId, result) },
        )
    }

    private fun callback(id: String, payload: JSONObject) {
        act.js("window.__androidCb && window.__androidCb(${JSONObject.quote(id)}, ${payload})")
    }

    /** Save a file (base64) into Downloads. */
    @JavascriptInterface fun saveFile(name: String, mime: String, base64: String) {
        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = act.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw Exception("no storage")
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                File(dir, name).writeBytes(bytes)
            }
            toast("Saved to Downloads: $name")
        } catch (e: Exception) {
            toast("Couldn't save the file: ${e.message}")
        }
    }

    /** Print (or save as PDF) what's on screen; tells the page when printing is finished. */
    @JavascriptInterface fun print(title: String) {
        act.runOnUiThread {
            val pm = act.getSystemService(Context.PRINT_SERVICE) as PrintManager
            val inner = act.web.createPrintDocumentAdapter(title.ifBlank { "Note" })
            val adapter = object : PrintDocumentAdapter() {
                override fun onStart() = inner.onStart()
                override fun onLayout(old: PrintAttributes?, new: PrintAttributes, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) =
                    inner.onLayout(old, new, cancel, cb, extras)
                override fun onWrite(pages: Array<out PageRange>, dest: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) =
                    inner.onWrite(pages, dest, cancel, cb)
                override fun onFinish() {
                    inner.onFinish()
                    act.js("window.androidPrintDone && window.androidPrintDone()")
                }
            }
            try { pm.print(title.ifBlank { "Note" }, adapter, null) }
            catch (e: Exception) { act.js("window.androidPrintDone && window.androidPrintDone()"); toast("Couldn't print: ${e.message}") }
        }
    }

    /** Recent notes for the home screen widget: JSON array of {id, title, snip}. */
    @JavascriptInterface fun updateRecent(json: String) {
        if (json == Prefs.recent(act)) return
        Prefs.setRecent(act, json)
        NotesWidget.refreshAll(act)
    }

    /** Upcoming note reminders: JSON array of {id, title, at}. */
    @JavascriptInterface fun setReminders(json: String) {
        Reminders.schedule(act, json)
        if (json.length > 2) act.askNotificationPermission()
    }

    /** Read the text in a picture (base64). Answers {text} or {error}. */
    @JavascriptInterface fun ocr(base64: String, callbackId: String) {
        PictureText.read(base64) { callback(callbackId, it) }
    }

    /** Open Google's document scanner. Pages arrive via window.androidScanPage, then {pages: n} or {error}. */
    @JavascriptInterface fun scanDocument(callbackId: String) = act.startScan(callbackId)

    /** Clipboard access (the WebView can't read the clipboard on its own). */
    @JavascriptInterface fun readClipboard(): String {
        val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip ?: return ""
        if (clip.itemCount == 0) return ""
        return clip.getItemAt(0).coerceToText(act)?.toString() ?: ""
    }

    @JavascriptInterface fun writeClipboard(text: String) {
        val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Notes", text))
    }

    @JavascriptInterface fun setBars(color: String, dark: Boolean) = act.setBars(color, dark)

    @JavascriptInterface fun settings() = act.askForServer(first = false)

    @JavascriptInterface fun retry() = act.runOnUiThread { act.loadServer() }

    @JavascriptInterface fun checkUpdate() = UpdateCheck.maybeCheck(act, manual = true)

    private fun toast(msg: String) = act.runOnUiThread { Toast.makeText(act, msg, Toast.LENGTH_LONG).show() }
}
