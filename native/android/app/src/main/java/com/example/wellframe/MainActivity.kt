package com.example.wellframe

import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.permission.PermissionController
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class MainActivity : ComponentActivity() {
    private lateinit var secure: SecureStore
    private lateinit var api: WellframeApi
    private lateinit var layout: LinearLayout
    private lateinit var status: TextView
    private lateinit var consent: CheckBox
    private var syncing = false
    private val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    private val permissionLauncher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        if (stepsPermission in granted) lifecycleScope.launch { syncSteps() }
        else say("Steps permission was not granted. Manual logging remains available on the website.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        secure = SecureStore(this)
        api = WellframeApi(secure)
        layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(28, 28, 28, 28) }
        setContentView(ScrollView(this).apply { addView(layout) })
        showScreen()
    }

    private fun text(value: String, size: Float = 16f): TextView = TextView(this).apply {
        this.text = value; textSize = size; setPadding(0, 8, 0, 8)
    }
    private fun button(title: String, action: () -> Unit): Button = Button(this).apply {
        text = title; setOnClickListener { action() }
    }
    private fun say(value: String) { status.text = value }

    private fun showScreen() {
        layout.removeAllViews()
        layout.addView(text("Wellframe", 28f))
        layout.addView(text("Your effort. Clearly seen. This companion brings selected Health Connect steps into your private account."))
        status = text("Sign in to choose what to share.", 14f)
        if (api.session == null) {
            val email = EditText(this).apply { hint = "Email"; inputType = 33 }
            val password = EditText(this).apply { hint = "Password"; inputType = 129 }
            layout.addView(email); layout.addView(password)
            layout.addView(button("Sign in") {
                lifecycleScope.launch {
                    try { api.signIn(email.text.toString().trim(), password.text.toString()); showScreen() }
                    catch (error: Exception) { say(error.message ?: "Sign-in failed.") }
                }
            })
            layout.addView(text("Create or manage your account on the Wellframe website. Credentials are protected by Android Keystore."))
        } else {
            consent = CheckBox(this).apply { text = "Upload my selected steps and source details to my Wellframe account" }
            layout.addView(consent)
            layout.addView(text("This cloud choice is separate from Health Connect permission. Sync works in the foreground when you press the button."))
            layout.addView(button("Choose steps access and sync") { lifecycleScope.launch { syncSteps() } })
            layout.addView(button("Disconnect this device") {
                secure.remove("steps-token:${api.session?.userId}")
                api.signOut(); showScreen()
                say("Disconnected. Revoke Health Connect permission in Android Settings if you wish.")
            })
            layout.addView(text("No records may mean no steps are available or read permission is not granted. This companion does not write to Health Connect."))
        }
        layout.addView(status)
    }

    private fun stableID(sourceID: String): String = UUID.nameUUIDFromBytes("healthconnect:steps:$sourceID".toByteArray()).toString()
    private fun record(id: String, payload: JSONObject): JSONObject = JSONObject()
        .put("recordId", stableID(id)).put("kind", "health_sample")
        .put("occurredAt", Instant.now().toString()).put("payload", payload)

    private suspend fun uploadStep(value: StepsRecord) {
        val id = value.metadata.id
        if (id.isBlank()) return
        val payload = JSONObject().put("metricType", "steps").put("unit", "count")
            .put("value", value.count).put("sampleStart", value.startTime.toString())
            .put("sampleEnd", value.endTime.toString()).put("sourceId", "healthconnect")
            .put("sourceSampleId", id).put("sourceName", value.metadata.dataOrigin.packageName)
            .put("sourceBundleId", value.metadata.dataOrigin.packageName).put("deleted", false)
        api.upload(record(id, payload))
    }

    private suspend fun uploadDeletion(id: String) {
        val payload = JSONObject().put("metricType", "steps").put("unit", "count")
            .put("sourceId", "healthconnect").put("sourceSampleId", id).put("deleted", true)
        api.upload(record(id, payload))
    }

    private suspend fun initialSnapshot(client: HealthConnectClient) {
        var pageToken: String? = null
        val filter = TimeRangeFilter.after(Instant.now().minus(30, ChronoUnit.DAYS))
        do {
            val page = client.readRecords(ReadRecordsRequest(StepsRecord::class, timeRangeFilter = filter, pageToken = pageToken))
            for (entry in page.records) if (entry.metadata.dataOrigin.packageName != packageName) uploadStep(entry)
            pageToken = page.pageToken
        } while (pageToken != null)
    }

    private suspend fun syncSteps() {
        if (syncing || api.session == null) return
        if (!consent.isChecked) { say("Choose cloud upload before syncing."); return }
        val availability = HealthConnectClient.getSdkStatus(this)
        if (availability != HealthConnectClient.SDK_AVAILABLE) {
            say("Health Connect is unavailable on this device. Manual logging is still available on the website.")
            return
        }
        val client = HealthConnectClient.getOrCreate(this)
        try {
            val granted = client.permissionController.getGrantedPermissions()
            if (stepsPermission !in granted) { permissionLauncher.launch(setOf(stepsPermission)); return }
            syncing = true; say("Syncing steps…")
            withContext(Dispatchers.IO) {
                val key = "steps-token:${api.session?.userId}"
                var token = secure.get(key)
                if (token == null) {
                    // Reserve a changes token before the snapshot so updates during the read are not lost.
                    token = client.getChangesToken(ChangesTokenRequest(recordTypes = setOf(StepsRecord::class)))
                    initialSnapshot(client)
                }
                var next = token ?: error("No Health Connect cursor was returned.")
                var more: Boolean
                do {
                    val changes = client.getChanges(next)
                    if (changes.changesTokenExpired) {
                        secure.remove(key)
                        error("The Health Connect cursor expired. Retry to rescan the last 30 days.")
                    }
                    for (change in changes.changes) when (change) {
                        is UpsertionChange -> {
                            val entry = change.record as? StepsRecord
                            if (entry != null && entry.metadata.dataOrigin.packageName != packageName) uploadStep(entry)
                        }
                        is DeletionChange -> uploadDeletion(change.recordId)
                    }
                    next = changes.nextChangesToken
                    secure.put(key, next)
                    more = changes.hasMore
                } while (more)
            }
            say("Sync finished. Health Connect may contain data from more than one source; raw samples are shown separately on the website.")
        } catch (error: Exception) {
            say(error.message ?: "Sync did not finish. Retry when ready.")
        } finally { syncing = false }
    }
}
