import SwiftUI
import AppKit
import UniformTypeIdentifiers

@MainActor @Observable
final class Workspace {
    var api = SentinelAPI(rememberSession: true)
    var media = MediaCache()
    var issues: [Issue] = []
    var trash: [Issue] = []
    var projects: [JSONValue] = []
    var fields: [Field] = []
    var captures: [JSONValue] = []
    var error: String?
    var loading = false
    var connected = false
    var needsLogin = false
    var account = "Local workspace"
    var section = "All issues"
    var project = ""
    var query = ""
    var status = ""
    var priority = ""
    var board = false
    var selection: Int?
    var editor: Issue?
    var saving = false
    var sort = "Updated"

    var selectedIssue: Issue? { issues.first { $0.id == selection } }
    var statuses: [String] { options("status") }
    func options(_ key: String) -> [String] { fields.first { $0.id == key }?.options ?? [] }
    func completed(_ issue: Issue) -> Bool {
        let category = fields.first { $0.id == "status" }?.raw["categories"][issue["status"]].string ?? ""
        return category == "completed" || (category.isEmpty && ["resolved", "closed", "done", "completed"].contains(issue["status"].lowercased()))
    }
    var filtered: [Issue] {
        let source = section == "Trash" ? trash : issues
        return source.filter {
            $0.matches(query) && (project.isEmpty || $0["project"].caseInsensitiveCompare(project) == .orderedSame)
            && (status.isEmpty || $0["status"] == status)
            && (priority.isEmpty || $0["priority"] == priority)
            && (section != "My issues" || $0["assignee"].caseInsensitiveCompare(account) == .orderedSame)
        }.sorted {
            if sort == "Priority" {
                let a = options("priority").firstIndex(of: $0["priority"]) ?? -1
                let b = options("priority").firstIndex(of: $1["priority"]) ?? -1
                if a != b { return a > b }
            }
            let key = sort == "Created" ? "createdAt" : "updatedAt"
            return $0[key] == $1[key] ? $0.id > $1.id : $0[key] > $1[key]
        }
    }
    func projectProfile(_ name: String) -> JSONValue? {
        projects.first { $0["name"].string.caseInsensitiveCompare(name) == .orderedSame }
    }
    func navigate(_ name: String, project: String = "") {
        section = name; self.project = project; query = ""; status = ""; priority = ""; selection = nil
    }
    func report(_ error: Error) {
        if (error as? APIError)?.status == 401 { needsLogin = true; media = MediaCache(); connected = false; issues = []; trash = []; captures = []; projects = []; selection = nil }
        self.error = error.localizedDescription
    }
    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let session = try await api.request("auth/session")
            needsLogin = session["enabled"].bool && session["user"] == .null
            guard !needsLogin else { clearAccount(); return }
            account = session["user"]["email"].string.nonEmpty ?? "Local workspace"
            async let bugs = api.request("bugs")
            async let projectData = api.request("projects")
            async let fieldData = api.request("fields")
            let (b, p, f) = try await (bugs, projectData, fieldData)
            issues = b.array.map { Issue(values: $0.object) }
            projects = p.array
            fields = f.array.map { Field(raw: $0) }
            connected = true
            if section == "Trash" { trash = try await api.request("trash").array.map { Issue(values: $0.object) } }
            if section == "Attachment inbox" { captures = try await api.request("inbox")["files"].array }
        } catch { connected = false; report(error) }
    }
    func login(email: String, password: String) async {
        do {
            _ = try await api.request("auth/login", method: "POST", body: .object(["email": .string(email), "password": .string(password), "remember": .bool(true)]))
            media = MediaCache()
            await refresh()
        } catch { report(error) }
    }
    private func clearAccount() {
        connected = false; needsLogin = true; account = "Local workspace"
        issues = []; trash = []; projects = []; fields = []; captures = []
        selection = nil; editor = nil; media = MediaCache()
    }
    func signOut() async {
        do {
            _ = try await api.request("auth/logout", method: "POST", body: .object([:]))
            clearAccount()
        } catch { report(error) }
    }
    func save(_ issue: Issue) async -> Bool {
        saving = true
        defer { saving = false }
        do {
            var body = issue.values
            if issue.id != 0 { body["expectedCreatedAt"] = issue.values["createdAt"] }
            let result = try await api.request(issue.id == 0 ? "bugs" : "bugs/\(issue.id)", method: issue.id == 0 ? "POST" : "PUT", body: .object(body))
            await refresh()
            selection = result["id"].int
            return true
        } catch { report(error); return false }
    }
    func changeStatus(_ issue: Issue, to status: String) async {
        do {
            _ = try await api.request("bugs/\(issue.id)/quick", method: "POST", body: .object(["status": .string(status)]))
            await refresh()
        } catch { report(error) }
    }
    func moveToTrash(_ issue: Issue) async {
        do { _ = try await api.request("bugs/\(issue.id)", method: "DELETE"); selection = nil; await refresh() }
        catch { report(error) }
    }
    func restore(_ issue: Issue) async {
        do { _ = try await api.request("trash/\(issue.id)/restore", method: "POST", body: .object([:])); await refresh() }
        catch { report(error) }
    }
    func exportBackup() async {
        do {
            let value = try await api.request("backup")
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.json]
            panel.nameFieldStringValue = "Sentinel-backup.json"
            guard await panel.begin() == .OK, let url = panel.url else { return }
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(value).write(to: url, options: .atomic)
        } catch { report(error) }
    }
    func openWeb(_ suffix: String = "") {
        if let url = URL(string: api.baseURL.absoluteString + "/" + suffix) { NSWorkspace.shared.open(url) }
    }
}
