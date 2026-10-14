import Foundation
import Testing
@testable import Sentinel

@Test func unknownFieldsRoundTrip() throws {
    let raw = Data(#"{"id":42,"issueType":"Idea","title":"Unicode 🐛","customFields":{"device":"MacBook"},"future":{"nested":[true,null,2.5]}}"#.utf8)
    let value = try JSONDecoder().decode(JSONValue.self, from: raw)
    var issue = Issue(values: value.object)
    issue["title"] = "Edited"
    let decoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(JSONValue.object(issue.values)))
    #expect(decoded["future"] == value["future"])
    #expect(decoded["customFields"] == value["customFields"])
    #expect(issue.label == "IDEA-42")
    #expect(issue.matches("macbook"))
    #expect(issue.matches("idea-42"))
    #expect(!issue.matches("missing"))
}

@Test func customOptionsAndFieldScope() {
    let field = Field(raw: .object(["key": .string("status"), "enabled": .bool(true), "builtin": .bool(true), "options": .array([.string("Triaged"), .string("Done")]), "issueTypes": .array([.string("Bug")])]))
    #expect(field.applies(to: "Bug"))
    #expect(!field.applies(to: "Idea"))
    #expect(Issue.blank(fields: [field])["status"] == "Triaged")
}

/// Run against scripts/test-server.mjs; it uses a temporary database, never user data.
@Test(.enabled(if: ProcessInfo.processInfo.environment["SENTINEL_TEST_URL"] != nil)) func realServerLifecycle() async throws {
    guard let address = ProcessInfo.processInfo.environment["SENTINEL_TEST_URL"], let url = URL(string: address) else { return }
    let api = SentinelAPI(baseURL: url)
    let session = try await api.request("auth/session")
    if session["enabled"].bool {
        _ = try await api.request("auth/login", method: "POST", body: .object(["email": .string("native-test@example.com"), "password": .string("Native test passphrase 123!")]))
    }
    let fields = try await api.request("fields").array.map { Field(raw: $0) }
    var draft = Issue.blank(fields: fields, project: "Native integration test")
    draft["title"] = "A SwiftUI-created issue"
    let created = try await api.request("bugs", method: "POST", body: .object(draft.values))
    let id = created["id"].int
    #expect(id > 0)
    var edit = created.object
    edit["title"] = .string("Edited from Swift")
    edit["expectedCreatedAt"] = created["createdAt"]
    let saved = try await api.request("bugs/\(id)", method: "PUT", body: .object(edit))
    #expect(saved["title"].string == "Edited from Swift")
    _ = try await api.request("bugs/\(id)/quick", method: "POST", body: .object(["status": .string("In progress")]))
    let commented = try await api.request("bugs/\(id)/comments", method: "POST", body: .object(["text": .string("Native comment")]))
    #expect(commented["comments"].array.last?["text"].string == "Native comment")
    #expect(commented["status"].string == "In progress")
    let image = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=")!
    let upload = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
    let download = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
    defer { try? FileManager.default.removeItem(at: upload); try? FileManager.default.removeItem(at: download) }
    try image.write(to: upload)
    try await api.upload(upload, issueID: id)
    let attachments = try await api.request("bugs/\(id)/attachments")
    #expect(attachments.array.count == 1)
    try await api.download("bugs/\(id)/attachments/\(attachments.array[0]["id"].string)", to: download)
    #expect(try Data(contentsOf: download) == image)
    let cache = MediaCache()
    let attachment = MediaItem(file: attachments.array[0], path: "bugs/\(id)/attachments/\(attachments.array[0]["id"].string)")
    let thumbnail = try await cache.thumbnail(for: attachment, api: api)
    #expect(thumbnail.width > 0 && thumbnail.width <= 600)
    let firstURL = try await cache.localURL(for: attachment, api: api)
    let secondURL = try await cache.localURL(for: attachment, api: api)
    #expect(firstURL == secondURL)
    #expect(try Data(contentsOf: firstURL) == image)
    if session["enabled"].bool {
        let inbox = try await api.request("inbox")["files"].array
        #expect(!inbox.isEmpty)
        if let file = inbox.first {
            let item = MediaItem(file: file, path: "inbox/\(file["id"].string)")
            let preview = try await cache.thumbnail(for: item, api: api)
            #expect(preview.width > 0)
            let anonymous = SentinelAPI(baseURL: url)
            do { try await anonymous.download(item.path, to: download); Testing.Issue.record("Anonymous media access should fail") }
            catch let error as APIError { #expect(error.status == 401) }
        }
    }

    _ = try await api.request("bugs/\(id)", method: "DELETE")
    let trash = try await api.request("trash")
    #expect(trash.array.contains { $0["id"].int == id })
    _ = try await api.request("trash/\(id)/restore", method: "POST", body: .object([:]))
    let bugs = try await api.request("bugs")
    #expect(bugs.array.contains { $0["id"].int == id })
    let backup = try await api.request("backup")
    #expect(backup["bugs"].array.contains { $0["id"].int == id })
}
