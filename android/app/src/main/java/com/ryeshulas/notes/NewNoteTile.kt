package com.ryeshulas.notes

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile: opens a new note. */
class NewNoteTile : TileService() {
    override fun onStartListening() {
        qsTile?.apply { state = Tile.STATE_INACTIVE; updateTile() }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(NotesWidget.openIntent(this, "new", null, 100))
        } else {
            val i = Intent(this, MainActivity::class.java)
                .setData(Uri.parse("notes://new/"))
                .putExtra(MainActivity.EXTRA_KIND, "new")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            @Suppress("DEPRECATION")
            startActivityAndCollapse(i)
        }
    }
}
