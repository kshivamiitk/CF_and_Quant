import SwiftUI

@MainActor final class CompanionModel: ObservableObject {
    @Published var signedIn: Bool
    @Published var message = ""
    let api: WellframeAPI
    let health: HealthSync

    init() {
        let api = WellframeAPI()
        self.api = api
        self.health = HealthSync(api: api)
        self.signedIn = api.session != nil
    }

    func signIn(email: String, password: String) async {
        do {
            try await api.signIn(email: email, password: password)
            signedIn = true
            message = "Signed in. Choose only the health types you want to share."
        } catch {
            message = error.localizedDescription
        }
    }

    func signOut() {
        health.clearAnchors()
        api.signOut()
        signedIn = false
        message = "Signed out. Health permissions can be changed in iPhone Settings."
    }
}

struct ContentView: View {
    @ObservedObject var model: CompanionModel
    @ObservedObject var health: HealthSync
    @State private var email = ""
    @State private var password = ""
    @State private var uploadConsent = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Your effort. Clearly seen.").font(.title2.bold())
                    Text("This iPhone companion can bring selected Apple Health measurements to your private Wellframe account. It does not read Apple Watch directly; Watch measurements appear through HealthKit on iPhone when available.")
                        .font(.subheadline)
                }
                if !model.signedIn {
                    Section("Sign in") {
                        TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                        SecureField("Password", text: $password).textContentType(.password)
                        Button("Sign in") { Task { await model.signIn(email: email, password: password) } }
                            .disabled(email.isEmpty || password.isEmpty)
                        Text("Create or manage your account on the Wellframe website. Sign-in credentials are held in this device's Keychain.")
                            .font(.footnote)
                    }
                } else {
                    Section("Choose data to read") {
                        if !health.available {
                            Text("Apple Health is unavailable on this device. You can still use manual logging on the website.")
                        } else {
                            ForEach(HealthMetric.allCases) { metric in
                                Toggle(metric.title, isOn: Binding(
                                    get: { health.selected.contains(metric) },
                                    set: { enabled in if enabled { health.selected.insert(metric) } else { health.selected.remove(metric) } }
                                ))
                            }
                        }
                    }
                    Section("Cloud upload") {
                        Toggle("Upload the selected measurements to my Wellframe account", isOn: $uploadConsent)
                        Text("This is separate from Apple's read permission. Selected values, measurement times and sources leave this device and are stored in your Supabase-backed account. You can review and export them on the website.")
                            .font(.footnote)
                        Button(health.syncing ? "Syncing…" : "Choose access and sync now") {
                            Task { await health.sync(uploadConsent: uploadConsent) }
                        }
                        .disabled(health.syncing || !health.available || health.selected.isEmpty || !uploadConsent)
                        Text("No result may mean no readable samples or that read permission was not granted. HealthKit does not reveal which.")
                            .font(.footnote)
                    }
                    Section("Sync status") {
                        Text(health.status)
                        if let date = health.lastSync { Text("Last successful sync: \(date.formatted(date: .abbreviated, time: .shortened))") }
                        if health.pending > 0 { Text("Pending in this sync: \(health.pending)") }
                        Text("Sync runs when you open this companion and press the button. Background sync is not enabled.").font(.footnote)
                    }
                    Section("Privacy") {
                        Button("Disconnect this device", role: .destructive) {
                            uploadConsent = false
                            model.signOut()
                        }
                        Text("Disconnecting clears this device's session and sync positions. To revoke Health access, use iPhone Settings > Health > Data Access & Devices. To remove uploaded records, use your Wellframe account's data controls.")
                            .font(.footnote)
                    }
                }
                if !model.message.isEmpty { Section { Text(model.message) } }
            }
            .navigationTitle("Wellframe")
        }
    }
}

@main struct WellframeApp: App {
    @StateObject private var model = CompanionModel()

    var body: some Scene {
        WindowGroup { ContentView(model: model, health: model.health) }
    }
}
