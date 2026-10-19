package com.example.wellframe

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class WellframeApi(private val secure: SecureStore) {
    data class Session(val access: String, val refresh: String, val expiresAt: Long, val userId: String)

    var session: Session? = secure.get("session")?.let { encoded ->
        runCatching {
            val value = JSONObject(encoded)
            Session(value.getString("access"), value.getString("refresh"), value.getLong("expiresAt"), value.getString("userId"))
        }.getOrNull()
    }
        private set

    val configured: Boolean get() = BuildConfig.API_BASE_URL.startsWith("https://") &&
        !BuildConfig.API_BASE_URL.contains("your-deployment") &&
        BuildConfig.SUPABASE_URL.startsWith("https://") && !BuildConfig.SUPABASE_URL.contains("your-project") &&
        !BuildConfig.SUPABASE_PUBLISHABLE_KEY.contains("your-publishable")

    private suspend fun post(url: String, body: JSONObject, bearer: String? = null): JSONObject = withContext(Dispatchers.IO) {
        if (!configured) error("Configure the API and Supabase URLs before connecting.")
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15000
            connection.readTimeout = 20000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            if (code !in 200..299) error("Service request failed (HTTP $code). Retry later.")
            JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }

    private fun remember(result: JSONObject, priorUser: String? = null) {
        val user = priorUser ?: result.optJSONObject("user")?.getString("id") ?: error("No account was returned.")
        val value = Session(result.getString("access_token"), result.getString("refresh_token"),
            System.currentTimeMillis() + result.optLong("expires_in", 3600L) * 1000L, user)
        session = value
        secure.put("session", JSONObject().put("access", value.access).put("refresh", value.refresh)
            .put("expiresAt", value.expiresAt).put("userId", value.userId).toString())
    }

    suspend fun signIn(email: String, password: String) {
        remember(post("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=password",
            JSONObject().put("email", email).put("password", password)))
    }

    private suspend fun token(): String {
        val current = session ?: error("Sign in again.")
        if (current.expiresAt > System.currentTimeMillis() + 60000L) return current.access
        remember(post("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", current.refresh)), current.userId)
        return session!!.access
    }

    suspend fun upload(record: JSONObject) {
        val bearer = token()
        for (attempt in 0..2) {
            try {
                post("${BuildConfig.API_BASE_URL}/api/consumer", record, bearer)
                return
            } catch (error: Exception) {
                if (attempt == 2 || error.message?.contains("HTTP 4") == true) throw error
                delay((1 shl attempt) * 1000L)
            }
        }
    }

    fun signOut() { session = null; secure.remove("session") }
}
