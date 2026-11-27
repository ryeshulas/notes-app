package com.ryeshulas.notes

import android.graphics.BitmapFactory
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONObject

/** Reads the text in a picture with Google ML Kit (on the device, through Google Play services). */
object PictureText {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    fun read(base64: String, done: (JSONObject) -> Unit) {
        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            // Decode at a sensible size (big photos don't read any better and use lots of memory).
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 3000) sample *= 2
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                ?: return done(JSONObject().put("error", "not a picture"))
            recognizer.process(InputImage.fromBitmap(bmp, 0))
                .addOnSuccessListener { done(JSONObject().put("text", it.text)) }
                .addOnFailureListener { done(JSONObject().put("error", it.message ?: "couldn't read the picture")) }
        } catch (e: Exception) {
            done(JSONObject().put("error", e.message ?: "couldn't read the picture"))
        }
    }
}
