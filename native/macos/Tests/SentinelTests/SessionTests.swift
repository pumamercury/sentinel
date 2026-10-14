import Foundation
import Testing
@testable import Sentinel

@Test(.enabled(if: ProcessInfo.processInfo.environment["SENTINEL_TEST_KEYCHAIN"] == "1"))
func rememberedSessionRestoresAndSignsOut() async throws {
    let address = try #require(ProcessInfo.processInfo.environment["SENTINEL_TEST_URL"])
    let url = try #require(URL(string: address))
    let service = "local.sentinel.tests." + UUID().uuidString
    let keychain = SessionKeychain(account: url.absoluteString, service: service)
    defer { try? keychain.delete() }
    let first = SentinelAPI(baseURL: url, rememberSession: true, keychainService: service)
    _ = try await first.request("auth/login", method: "POST", body: .object(["email": .string("native-test@example.com"), "password": .string("Native test passphrase 123!"), "remember": .bool(true)]))
    let saved = try #require(keychain.read())
    #expect(saved.expires > Date().addingTimeInterval(29 * 86400))
    let reopened = SentinelAPI(baseURL: url, rememberSession: true, keychainService: service)
    let session = try await reopened.request("auth/session")
    #expect(session["user"]["email"].string == "native-test@example.com")
    _ = try await reopened.request("auth/logout", method: "POST", body: .object([:]))
    #expect(try keychain.read() == nil)
    let afterLogout = SentinelAPI(baseURL: url, rememberSession: true, keychainService: service)
    #expect(try await afterLogout.request("auth/session")["user"] == .null)
    try keychain.write(SavedSession(name: saved.name, value: saved.value, expires: Date().addingTimeInterval(-1)))
    let expired = SentinelAPI(baseURL: url, rememberSession: true, keychainService: service)
    #expect(try await expired.request("auth/session")["user"] == .null)
    #expect(try keychain.read() == nil)
}
