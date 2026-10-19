import Foundation

struct AuthSession: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userID: String
}

enum APIError: LocalizedError {
    case setup, unauthorized, server(Int), invalidResponse

    var errorDescription: String? {
        switch self {
        case .setup: return "Set the API and Supabase URLs in the iOS project first."
        case .unauthorized: return "Please sign in again."
        case .server(let code): return "Sync could not finish (HTTP \(code)). Retry later."
        case .invalidResponse: return "The service returned an unexpected response."
        }
    }
}

final class WellframeAPI {
    private let apiBase = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String ?? ""
    private let supabaseBase = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String ?? ""
    private let publishableKey = Bundle.main.object(forInfoDictionaryKey: "SupabasePublishableKey") as? String ?? ""
    private(set) var session: AuthSession?

    init() {
        if let data = KeychainStore.read() { session = try? JSONDecoder().decode(AuthSession.self, from: data) }
    }

    var configured: Bool {
        apiBase.hasPrefix("https://") && !apiBase.contains("your-deployment") &&
        supabaseBase.hasPrefix("https://") && !supabaseBase.contains("your-project") &&
        !publishableKey.contains("your-publishable")
    }

    private func auth(path: String, body: [String: Any]) async throws -> [String: Any] {
        guard configured, let url = URL(string: supabaseBase + "/auth/v1/" + path) else { throw APIError.setup }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.server(http.statusCode) }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw APIError.invalidResponse }
        return value
    }

    private func keepSession(_ result: [String: Any], userID: String?) throws {
        guard let access = result["access_token"] as? String,
              let refresh = result["refresh_token"] as? String else { throw APIError.invalidResponse }
        let id = userID ?? ((result["user"] as? [String: Any])?["id"] as? String)
        guard let id else { throw APIError.invalidResponse }
        let lifetime = (result["expires_in"] as? Double) ?? Double((result["expires_in"] as? Int) ?? 3600)
        let value = AuthSession(accessToken: access, refreshToken: refresh, expiresAt: Date().addingTimeInterval(lifetime), userID: id)
        session = value
        KeychainStore.save(try JSONEncoder().encode(value))
    }

    func signIn(email: String, password: String) async throws {
        let result = try await auth(path: "token?grant_type=password", body: ["email": email, "password": password])
        try keepSession(result, userID: nil)
    }

    func signOut() {
        session = nil
        KeychainStore.clear()
    }

    private func token() async throws -> String {
        guard let current = session else { throw APIError.unauthorized }
        if current.expiresAt > Date().addingTimeInterval(60) { return current.accessToken }
        let result = try await auth(path: "token?grant_type=refresh_token", body: ["refresh_token": current.refreshToken])
        try keepSession(result, userID: current.userID)
        guard let refreshed = session else { throw APIError.unauthorized }
        return refreshed.accessToken
    }

    func send(record: [String: Any]) async throws {
        guard configured, let url = URL(string: apiBase + "/api/consumer") else { throw APIError.setup }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: record)
        for attempt in 0..<3 {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            if (200..<300).contains(http.statusCode) { return }
            if http.statusCode == 401 { throw APIError.unauthorized }
            if (http.statusCode == 429 || http.statusCode >= 500) && attempt < 2 {
                try await Task.sleep(nanoseconds: UInt64(1 << attempt) * 1_000_000_000)
                continue
            }
            throw APIError.server(http.statusCode)
        }
    }
}
