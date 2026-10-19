import Foundation
import HealthKit

enum HealthMetric: String, CaseIterable, Identifiable {
    case steps, activeEnergy, heartRate

    var id: String { rawValue }
    var title: String {
        switch self {
        case .steps: return "Steps"
        case .activeEnergy: return "Active energy"
        case .heartRate: return "Heart rate"
        }
    }
    var metricType: String {
        switch self {
        case .steps: return "steps"
        case .activeEnergy: return "active_energy"
        case .heartRate: return "heart_rate"
        }
    }
    var unitName: String {
        switch self {
        case .steps: return "count"
        case .activeEnergy: return "kcal"
        case .heartRate: return "bpm"
        }
    }
    var healthUnit: HKUnit {
        switch self {
        case .steps: return .count()
        case .activeEnergy: return .kilocalorie()
        case .heartRate: return HKUnit.count().unitDivided(by: .minute())
        }
    }
    var sampleType: HKQuantityType {
        let identifier: HKQuantityTypeIdentifier
        switch self {
        case .steps: identifier = .stepCount
        case .activeEnergy: identifier = .activeEnergyBurned
        case .heartRate: identifier = .heartRate
        }
        return HKObjectType.quantityType(forIdentifier: identifier)!
    }
}

@MainActor final class HealthSync: ObservableObject {
    @Published var selected: Set<HealthMetric> = [.steps]
    @Published var status = "Choose the data you want to share. You can skip this."
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var pending = 0

    private let store = HKHealthStore()
    private let api: WellframeAPI
    private let formatter = ISO8601DateFormatter()

    init(api: WellframeAPI) { self.api = api }
    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    private func anchorKey(_ metric: HealthMetric) -> String {
        "health-anchor-\(api.session?.userID ?? "signed-out")-\(metric.rawValue)"
    }
    private func anchor(_ metric: HealthMetric) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: anchorKey(metric)) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }
    private func saveAnchor(_ value: HKQueryAnchor, metric: HealthMetric) throws {
        let data = try NSKeyedArchiver.archivedData(withRootObject: value, requiringSecureCoding: true)
        UserDefaults.standard.set(data, forKey: anchorKey(metric))
    }
    func clearAnchors() {
        for metric in HealthMetric.allCases { UserDefaults.standard.removeObject(forKey: anchorKey(metric)) }
    }

    private func changes(for metric: HealthMetric, from anchor: HKQueryAnchor?) async throws -> ([HKSample], [HKDeletedObject], HKQueryAnchor?) {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(type: metric.sampleType, predicate: nil, anchor: anchor, limit: 100) { _, samples, deleted, newAnchor, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (samples ?? [], deleted ?? [], newAnchor)) }
            }
            store.execute(query)
        }
    }

    private func payload(_ sample: HKQuantitySample, metric: HealthMetric) -> [String: Any] {
        ["metricType": metric.metricType, "unit": metric.unitName,
         "value": sample.quantity.doubleValue(for: metric.healthUnit),
         "sampleStart": formatter.string(from: sample.startDate), "sampleEnd": formatter.string(from: sample.endDate),
         "sourceId": "healthkit", "sourceSampleId": sample.uuid.uuidString.lowercased(),
         "sourceName": sample.sourceRevision.source.name,
         "sourceBundleId": sample.sourceRevision.source.bundleIdentifier,
         "deleted": false]
    }

    private func record(id: UUID, data: [String: Any]) -> [String: Any] {
        ["kind": "health_sample", "recordId": id.uuidString.lowercased(),
         "occurredAt": formatter.string(from: Date()), "payload": data]
    }

    func sync(uploadConsent: Bool) async {
        guard !syncing else { return }
        guard available else { status = "Apple Health is unavailable on this device. Manual logging is still available on the web."; return }
        guard !selected.isEmpty else { status = "Choose at least one data type, or continue without connecting."; return }
        guard uploadConsent else { status = "Choose cloud upload before syncing. Your device permission alone does not upload data."; return }
        guard api.session != nil else { status = "Sign in first."; return }
        syncing = true
        status = "Requesting access to the types you chose…"
        defer { syncing = false }
        do {
            try await store.requestAuthorization(toShare: [], read: Set(selected.map { $0.sampleType }))
            for metric in selected.sorted(by: { $0.rawValue < $1.rawValue }) {
                var current = anchor(metric)
                while true {
                    let (samples, deleted, next) = try await changes(for: metric, from: current)
                    pending = samples.count + deleted.count
                    status = pending > 0 ? "Uploading \(pending) \(metric.title.lowercased()) changes…" : "Checking \(metric.title.lowercased())…"
                    for object in samples {
                        guard let quantity = object as? HKQuantitySample else { continue }
                        try await api.send(record: record(id: quantity.uuid, data: payload(quantity, metric: metric)))
                        pending -= 1
                    }
                    for object in deleted {
                        let tombstone: [String: Any] = ["metricType": metric.metricType, "unit": metric.unitName,
                                                        "sourceId": "healthkit", "sourceSampleId": object.uuid.uuidString.lowercased(),
                                                        "deleted": true]
                        try await api.send(record: record(id: object.uuid, data: tombstone))
                        pending -= 1
                    }
                    if let next { try saveAnchor(next, metric: metric); current = next }
                    if samples.count + deleted.count < 100 { break }
                }
            }
            pending = 0
            lastSync = Date()
            status = "Sync finished. Empty results do not reveal whether read access was denied or no records exist."
        } catch {
            status = "Sync did not finish. Your last successful position is retained. Retry when ready."
        }
    }
}
