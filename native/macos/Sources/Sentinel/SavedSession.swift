import Foundation
import Security

/// A session token, never the user's password. Keychain entries are scoped to the server origin.
struct SavedSession: Codable, Sendable {
    let name: String
    let value: String
    let expires: Date
}

struct SessionKeychain: Sendable {
    let account: String
    var service = "local.sentinel.macos.session"
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    func read() throws -> SavedSession? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data else { return nil }
        return try JSONDecoder().decode(SavedSession.self, from: data)
    }
    func write(_ session: SavedSession) throws {
        let data = try JSONEncoder().encode(session)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var attributes = query
            attributes[kSecValueData as String] = data
            attributes[kSecAttrLabel as String] = "Sentinel remembered sign-in"
            try check(SecItemAdd(attributes as CFDictionary, nil))
        } else { try check(update) }
    }
    func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }
    private func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else {
            throw APIError(status: Int(status), message: "Sentinel could not access its saved sign-in in Keychain: \(SecCopyErrorMessageString(status, nil) as String? ?? String(status))")
        }
    }
}

actor SessionPersistence {
    private let keychain: SessionKeychain
    private let origin: URL
    private var restored = false
    init(origin: URL, service: String = "local.sentinel.macos.session") {
        self.origin = origin
        self.keychain = SessionKeychain(account: origin.absoluteString, service: service)
    }
    func restore(into session: URLSession) throws {
        guard !restored else { return }
        if let saved = try keychain.read() {
            if saved.expires > Date(), ["sentinel-session", "__Host-sentinel"].contains(saved.name), !saved.value.isEmpty {
                var properties: [HTTPCookiePropertyKey: Any] = [.name: saved.name, .value: saved.value, .domain: origin.host!, .path: "/", .expires: saved.expires]
                if origin.scheme == "https" { properties[.secure] = "TRUE" }
                if let cookie = HTTPCookie(properties: properties) { session.configuration.httpCookieStorage?.setCookie(cookie) }
            } else { try keychain.delete() }
        }
        restored = true
    }
    func save(from session: URLSession) throws {
        let cookies = session.configuration.httpCookieStorage?.cookies(for: origin) ?? []
        if let cookie = cookies.first(where: { ["sentinel-session", "__Host-sentinel"].contains($0.name) }), let expires = cookie.expiresDate, expires > Date(), !cookie.value.isEmpty {
            try keychain.write(SavedSession(name: cookie.name, value: cookie.value, expires: expires))
        } else { try keychain.delete() }
    }
    func clear(from session: URLSession) throws {
        for cookie in session.configuration.httpCookieStorage?.cookies(for: origin) ?? [] {
            session.configuration.httpCookieStorage?.deleteCookie(cookie)
        }
        restored = true
        try keychain.delete()
    }
}
