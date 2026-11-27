package com.ryeshulas.notes

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The app is the notes web app running inside a WebView (so it stays in step with the server and keeps
 * working offline through the web app's own cache), plus native extras: S Pen handwriting to text,
 * the home screen widget, the Quick Settings tile, sharing into notes, printing and saving exports.
 */
class MainActivity : Activity() {
    lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var showingError = false

    /** What to do once the page is ready: {kind: new|write|open|share, id?} */
    @Volatile var pendingAction: String? = null
    /** Text/pictures shared from another app, as JSON. */
    @Volatile var pendingShare: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#F5F3EE"))
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        applyInsets()
        setBars("#F5F3EE", false)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            textZoom = 100
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString NotesAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(this), "NotesAndroid")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()

        handleIntent(intent)
        val url = Prefs.serverUrl(this)
        if (url == null) askForServer(first = true) else loadServer()
        UpdateCheck.maybeCheck(this, manual = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
        js("window.androidOpen && window.androidOpen()")
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.androidBack && window.androidBack()) ? 1 : 0") { r ->
            if (r != "1") moveTaskToBack(true)
        }
    }

    // ---------------------------------------------------------------- loading

    fun loadServer() {
        val base = Prefs.serverUrl(this) ?: return
        showingError = false
        web.loadUrl("$base/?app=1")
    }

    fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    fun askForServer(first: Boolean) = runOnUiThread {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad / 2, pad, 0) }
        val hint = TextView(this).apply {
            text = "Enter the address of your notes server (the Cloudflare tunnel address you use in the browser)."
        }
        val input = EditText(this).apply {
            setSingleLine()
            setText(Prefs.serverUrl(this@MainActivity) ?: "https://")
            setSelection(text.length)
        }
        box.addView(hint)
        box.addView(input)
        val dlg = AlertDialog.Builder(this)
            .setTitle(if (first) "Welcome to Notes" else "Server address")
            .setView(box)
            .setCancelable(!first)
            .setPositiveButton("Connect", null)
            .apply { if (!first) setNegativeButton("Cancel", null) }
            .create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = Prefs.normalise(input.text.toString())
                if (url == null) { input.error = "That doesn't look like an address"; return@setOnClickListener }
                Prefs.setServerUrl(this, url)
                dlg.dismiss()
                loadServer()
            }
        }
        dlg.show()
    }

    private fun showError(message: String) {
        if (showingError) return
        showingError = true
        val html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;background:#F5F3EE;color:#2b2a26;padding:32px 24px;text-align:center}
            button{font-size:17px;padding:12px 22px;margin:8px;border-radius:10px;border:1px solid #c9c3b4;background:#fff}
            .p{background:#f5c84c;border-color:#d99a00}</style></head><body>
            <h2>Can't reach your notes server</h2>
            <p>This can happen the first time the app opens without a connection.
            Once it has opened once while online, your notes work offline.</p>
            <p style="color:#888;font-size:13px">${android.text.Html.escapeHtml(message)}</p>
            <button class="p" onclick="NotesAndroid.retry()">Try again</button>
            <button onclick="NotesAndroid.settings()">Change server address</button>
            </body></html>""".trimIndent()
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    // ---------------------------------------------------------------- intents (widget, tile, share)

    private fun handleIntent(i: Intent?) {
        if (i == null) return
        when (i.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> {
                pendingShare = readShare(i)
                pendingAction = JSONObject().put("kind", "share").toString()
            }
            else -> {
                val kind = i.getStringExtra(EXTRA_KIND) ?: return
                val o = JSONObject().put("kind", kind)
                i.getStringExtra(EXTRA_NOTE_ID)?.let { o.put("id", it) }
                pendingAction = o.toString()
                i.removeExtra(EXTRA_KIND)
            }
        }
    }

    private fun readShare(i: Intent): String {
        val o = JSONObject()
        val subject = i.getStringExtra(Intent.EXTRA_SUBJECT)
        val text = i.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        if (!subject.isNullOrBlank()) o.put("title", subject)
        if (!text.isNullOrBlank()) o.put("text", text)
        val uris = mutableListOf<Uri>()
        if (i.action == Intent.ACTION_SEND_MULTIPLE) {
            @Suppress("DEPRECATION")
            i.getParcelableArrayListExtra<Parcelable>(Intent.EXTRA_STREAM)?.forEach { if (it is Uri) uris.add(it) }
        } else {
            @Suppress("DEPRECATION")
            (i.getParcelableExtra<Parcelable>(Intent.EXTRA_STREAM) as? Uri)?.let { uris.add(it) }
        }
        val images = JSONArray()
        for (u in uris.take(10)) {
            try {
                val type = contentResolver.getType(u) ?: "image/jpeg"
                if (!type.startsWith("image/")) continue
                val bytes = contentResolver.openInputStream(u)?.use { it.readBytes() } ?: continue
                if (bytes.size > 25 * 1024 * 1024) continue
                images.put(JSONObject().put("type", type).put("name", u.lastPathSegment ?: "picture")
                    .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
            } catch (e: Exception) { /* skip unreadable files */ }
        }
        if (images.length() > 0) o.put("images", images)
        return o.toString()
    }

    // ---------------------------------------------------------------- picking pictures / files

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val accept = params.acceptTypes.joinToString(",").lowercase()
            val multiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
            try {
                if (params.isCaptureEnabled) {
                    val dir = File(cacheDir, "camera").apply { mkdirs() }
                    val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                    cameraUri = uri
                    val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                        .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    startActivityForResult(cam, REQ_CAMERA)
                } else if (accept == "image/*" && Build.VERSION.SDK_INT >= 33) {
                    // The Android photo picker
                    val pick = Intent(MediaStore.ACTION_PICK_IMAGES)
                    if (multiple) pick.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 20)
                    startActivityForResult(pick, REQ_FILE)
                } else {
                    val get = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE)
                    when {
                        accept.contains("json") -> get.type = "*/*"
                        accept.contains("image") || accept.contains(".jpg") || accept.contains(".png") -> {
                            get.type = "*/*"
                            get.putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*"))
                        }
                        else -> get.type = "*/*"
                    }
                    get.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
                    startActivityForResult(Intent.createChooser(get, "Choose a file"), REQ_FILE)
                }
            } catch (e: Exception) {
                fileCallback = null
                callback.onReceiveValue(null)
                Toast.makeText(this@MainActivity, "Couldn't open the picker: ${e.message}", Toast.LENGTH_LONG).show()
            }
            return true
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val cb = fileCallback ?: return
        fileCallback = null
        if (resultCode != RESULT_OK) { cb.onReceiveValue(null); return }
        val result: Array<Uri>? = when (requestCode) {
            REQ_CAMERA -> cameraUri?.let { arrayOf(it) }
            else -> {
                val list = mutableListOf<Uri>()
                data?.clipData?.let { c -> for (k in 0 until c.itemCount) list.add(c.getItemAt(k).uri) }
                if (list.isEmpty()) data?.data?.let { list.add(it) }
                if (list.isEmpty()) null else list.toTypedArray()
            }
        }
        cb.onReceiveValue(result)
    }

    // ---------------------------------------------------------------- navigation

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val base = Prefs.serverUrl(this@MainActivity)?.let { Uri.parse(it) }
            val u = request.url
            if (base != null && u.host == base.host) return false
            // Anything else (links in notes) opens in the browser.
            return try { startActivity(Intent(Intent.ACTION_VIEW, u)); true } catch (e: Exception) { true }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showError(error.description?.toString() ?: "network error")
        }
    }

    // ---------------------------------------------------------------- window look

    private fun applyInsets() {
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    /** Status/navigation bar colour and icon colour, to match the app's light or dark appearance. */
    fun setBars(color: String, dark: Boolean) = runOnUiThread {
        val c = try { Color.parseColor(color) } catch (e: Exception) { return@runOnUiThread }
        root.setBackgroundColor(c)
        @Suppress("DEPRECATION")
        run { window.statusBarColor = c; window.navigationBarColor = c }
        if (Build.VERSION.SDK_INT >= 30) {
            val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else flags, flags)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
    }

    companion object {
        const val EXTRA_KIND = "notes_kind"
        const val EXTRA_NOTE_ID = "notes_id"
        private const val REQ_FILE = 1
        private const val REQ_CAMERA = 2
    }
}
