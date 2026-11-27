package com.ryeshulas.notes

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import org.json.JSONArray
import org.json.JSONObject

/**
 * Handwriting to text with Google ML Kit. Runs on the device; the English model (~20 MB) downloads
 * once on first use and works offline after that. Each line of writing is recognised separately.
 */
object Handwriting {
    private val model: DigitalInkRecognitionModel by lazy {
        val id = DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US")
            ?: throw IllegalStateException("no English handwriting model")
        DigitalInkRecognitionModel.builder(id).build()
    }
    private var recognizer: DigitalInkRecognizer? = null

    fun recognize(linesJson: String, status: (String) -> Unit, done: (JSONObject) -> Unit) {
        val lines: List<Ink> = try { parse(linesJson) } catch (e: Exception) {
            done(JSONObject().put("error", "Couldn't read the handwriting (${e.message})")); return
        }
        if (lines.isEmpty()) { done(JSONObject().put("lines", JSONArray())); return }
        val mgr = RemoteModelManager.getInstance()
        mgr.isModelDownloaded(model)
            .addOnSuccessListener { ready ->
                if (ready) run(lines, done)
                else {
                    status("downloading")
                    mgr.download(model, DownloadConditions.Builder().build())
                        .addOnSuccessListener { run(lines, done) }
                        .addOnFailureListener { done(JSONObject().put("error", "Couldn't download the handwriting model. Connect to the internet once and try again. (${it.message})")) }
                }
            }
            .addOnFailureListener { done(JSONObject().put("error", it.message ?: "handwriting recognition isn't available")) }
    }

    private fun run(lines: List<Ink>, done: (JSONObject) -> Unit) {
        val rec = recognizer ?: DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build()).also { recognizer = it }
        val out = JSONArray()
        fun next(i: Int) {
            if (i >= lines.size) { done(JSONObject().put("lines", out)); return }
            rec.recognize(lines[i])
                .addOnSuccessListener { r ->
                    val cands = r.candidates
                    val alts = JSONArray()
                    cands.drop(1).take(3).forEach { alts.put(it.text) }
                    out.put(JSONObject().put("text", cands.firstOrNull()?.text ?: "").put("alts", alts))
                    next(i + 1)
                }
                .addOnFailureListener { done(JSONObject().put("error", it.message ?: "recognition failed")) }
        }
        next(0)
    }

    private fun parse(json: String): List<Ink> {
        val lines = JSONArray(json)
        val result = ArrayList<Ink>()
        for (l in 0 until lines.length()) {
            val strokes = lines.getJSONArray(l)
            val ink = Ink.builder()
            var t = 0L
            for (s in 0 until strokes.length()) {
                val pts = strokes.getJSONArray(s)
                if (pts.length() < 2) continue
                val sb = Ink.Stroke.builder()
                var k = 0
                while (k + 1 < pts.length()) {
                    sb.addPoint(Ink.Point.create(pts.getDouble(k).toFloat(), pts.getDouble(k + 1).toFloat(), t))
                    t += 10
                    k += 2
                }
                ink.addStroke(sb.build())
                t += 200
            }
            result.add(ink.build())
        }
        return result
    }
}
