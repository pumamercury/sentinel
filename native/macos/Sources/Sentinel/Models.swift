import Foundation

/// Preserve server-defined fields so native edits never discard custom values.
enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    var string: String { if case .string(let v) = self { v } else { "" } }
    var object: [String: JSONValue] { if case .object(let v) = self { v } else { [:] } }
    var array: [JSONValue] { if case .array(let v) = self { v } else { [] } }
    var bool: Bool { self == .bool(true) }
    var int: Int { if case .number(let v) = self { Int(v) } else { 0 } }
    subscript(_ key: String) -> JSONValue { object[key] ?? .null }
}

struct Issue: Identifiable, Hashable, Sendable {
    var values: [String: JSONValue]
    var id: Int { values["id"]?.int ?? 0 }
    subscript(_ key: String) -> String {
        get { values[key]?.string ?? "" }
        set { values[key] = .string(newValue) }
    }
    var label: String {
        let prefix = ["Bug": "BUG", "Idea": "IDEA", "Task": "TASK", "Feature request": "FEAT"][self["issueType"]] ?? "ISSUE"
        return "\(prefix)-\(id)"
    }
    var symbol: String {
        ["Bug": "ladybug", "Idea": "lightbulb", "Task": "checkmark.square", "Feature request": "sparkles"][self["issueType"]] ?? "circle"
    }
    func matches(_ query: String) -> Bool {
        query.isEmpty || label.localizedCaseInsensitiveContains(query) || searchable(.object(values)).localizedCaseInsensitiveContains(query)
    }
    private func searchable(_ value: JSONValue) -> String {
        switch value {
        case .string(let s): s
        case .object(let o): o.values.map(searchable).joined(separator: " ")
        case .array(let a): a.map(searchable).joined(separator: " ")
        default: ""
        }
    }
    static func blank(fields: [Field], project: String = "") -> Issue {
        var issue = Issue(values: ["customFields": .object([:])])
        for field in fields where field.builtin { issue[field.id] = "" }
        for (key, fallback) in [("issueType", "Bug"), ("status", "Open"), ("priority", "Medium"), ("severity", "Major")] {
            let choices = fields.first { $0.id == key }?.options ?? []
            issue[key] = choices.contains(fallback) ? fallback : (choices.first ?? fallback)
        }
        issue["project"] = project
        return issue
    }
}

struct Field: Identifiable, Sendable {
    let raw: JSONValue
    var id: String { raw["key"].string }
    var label: String { raw["label"].string }
    var type: String { raw["type"].string }
    var builtin: Bool { raw["builtin"].bool }
    var required: Bool { raw["required"].bool }
    var options: [String] { raw["options"].array.map(\.string) }
    func applies(to type: String) -> Bool {
        let types = raw["issueTypes"].array.map(\.string)
        return raw["enabled"].bool && (types.isEmpty || types.contains(type))
    }
}

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

struct SentinelAPI: Sendable {
    let baseURL: URL
    let session: URLSession
    let persistence: SessionPersistence?
    init(baseURL: URL = URL(string: "http://127.0.0.1:5173")!, rememberSession: Bool = false, keychainService: String = "local.sentinel.macos.session") {
        self.persistence = rememberSession ? SessionPersistence(origin: baseURL, service: keychainService) : nil
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 20
        self.session = URLSession(configuration: configuration)
    }
    func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> JSONValue {
        try await persistence?.restore(into: session)
        var request = URLRequest(url: baseURL.appendingPathComponent("api/" + path))
        request.httpMethod = method
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let value = try? JSONDecoder().decode(JSONValue.self, from: data)
        if status == 401 && path != "auth/login" || (path == "auth/session" && value?["enabled"].bool == true && value?["user"] == .null) || (path == "auth/logout" && (200..<300).contains(status)) {
            try await persistence?.clear(from: session)
        } else if (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie") != nil {
            try await persistence?.save(from: session)
        }
        guard (200..<300).contains(status) else {
            throw APIError(status: status, message: value?["error"].string.nonEmpty ?? "The server returned HTTP \(status).")
        }
        guard let value else { throw APIError(status: status, message: "The server did not return Sentinel data.") }
        return value
    }
}
extension String { var nonEmpty: String? { isEmpty ? nil : self } }
