import SwiftUI

struct ProjectsView: View {
    @Bindable var workspace: Workspace
    @State private var editing: JSONValue?
    @State private var showEditor = false
    var body: some View {
        ScrollView {
            HStack { Spacer(); Button("New project", systemImage: "plus") { editing = nil; showEditor = true }.buttonStyle(.glass) }.padding(.horizontal, 30).padding(.bottom, 16)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 16)], spacing: 16) {
                ForEach(workspace.projects, id: \.self) { project in
                    let name = project["name"].string
                    let issues = workspace.issues.filter { $0["project"] == name }
                    Button { workspace.navigate("All issues", project: name) } label: {
                        VStack(alignment: .leading, spacing: 18) {
                            HStack { ProjectIcon(name: name, size: 42, profile: project); Spacer(); Image(systemName: "arrow.up.right").foregroundStyle(Color.muted) }
                            Text(name).font(.title3.weight(.semibold))
                            Text(project["description"].string.nonEmpty ?? "Every detail. Every next step.").font(.system(size: 12)).foregroundStyle(Color.muted).lineLimit(2).frame(height: 35, alignment: .top)
                            Divider()
                            HStack { Text("\(issues.count) issues"); Spacer(); Text("\(issues.filter { !workspace.completed($0) }.count) open") }.font(.system(size: 11)).foregroundStyle(.secondary)
                        }.padding(22).background(Color.panel, in: RoundedRectangle(cornerRadius: 16))
                            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white.opacity(0.06)))
                    }.buttonStyle(.plain).contextMenu { Button("Edit project") { editing = project; showEditor = true } }
                }
            }.padding(.horizontal, 30).padding(.bottom, 30)
            if workspace.projects.isEmpty { ContentUnavailableView("No projects yet", systemImage: "square.grid.2x2", description: Text("Create an issue with a project name to get started.")) }
        }.sheet(isPresented: $showEditor) { ProjectEditor(workspace: workspace, project: editing ?? .object([:])) }
    }
}
struct InboxView: View {
    @Bindable var workspace: Workspace
    @State private var assigning = false
    @State private var preview: MediaItem?
    @State private var assignedNotice: String?
    var body: some View {
        VStack {
            HStack {
                Text("\(workspace.captures.count) captures").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Capture settings ↗") { workspace.openWeb("?view=inbox") }.buttonStyle(.glass)
            }.padding(.horizontal, 30)
            if let assignedNotice { Label(assignedNotice, systemImage: "checkmark.circle.fill").font(.callout).foregroundStyle(.green).padding(.horizontal, 30) }
            if workspace.captures.isEmpty {
                ContentUnavailableView("All caught up", systemImage: "tray", description: Text("Screenshots and recordings collected by Sentinel appear here."))
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 250, maximum: 380), spacing: 18)], spacing: 18) {
                        ForEach(workspace.captures, id: \.self) { capture in
                            let item = MediaItem(file: capture, path: "inbox/\(capture["id"].string)")
                            VStack(alignment: .leading, spacing: 0) {
                                MediaThumbnail(workspace: workspace, item: item)
                                    .contentShape(Rectangle()).onTapGesture { preview = item }
                                    .accessibilityAddTraits(.isButton).accessibilityAction { preview = item }
                                VStack(alignment: .leading, spacing: 12) {
                                    Button { preview = item } label: { Text(item.name).font(.system(size: 13, weight: .medium)).lineLimit(2).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading) }.buttonStyle(.plain)
                                    HStack { Text(item.isVideo ? "Video" : "Image"); Text("·"); Text(ByteCountFormatter.string(fromByteCount: Int64(capture["size"].int), countStyle: .file)) }.font(.caption).foregroundStyle(Color.muted)
                                    HStack {
                                        Button("Preview", systemImage: "arrow.up.left.and.arrow.down.right") { preview = item }.buttonStyle(.glass)
                                        Spacer()
                                        Menu("Attach to issue") {
                                            ForEach(workspace.issues) { issue in Button("\(issue.label) · \(issue["title"])") { Task { await assign(capture, to: issue) } } }
                                        }.fixedSize().disabled(assigning || workspace.issues.isEmpty)
                                    }.controlSize(.small)
                                }.padding(14)
                            }.background(Color.panel, in: RoundedRectangle(cornerRadius: 14)).clipShape(RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(0.08)))
                        }
                    }.padding(30)
                }
            }
        }.sheet(item: $preview) { item in MediaPreview(workspace: workspace, item: item) }
    }
    private func assign(_ capture: JSONValue, to issue: Issue) async {
        assigning = true
        defer { assigning = false }
        do {
            _ = try await workspace.api.request("inbox/assign", method: "POST", body: .object(["ids": .array([capture["id"]]), "issueId": .number(Double(issue.id))]))
            assignedNotice = "Attached \(capture["name"].string) to \(issue.label)"
            await workspace.refresh()
        } catch { workspace.report(error) }
    }
}
struct LoginView: View {
    @Bindable var workspace: Workspace
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SentinelRobot().frame(width: 56, height: 56)
            Text("Welcome to Sentinel").font(.title.weight(.semibold))
            Text("Sign in once. Sentinel remembers you on this Mac.").foregroundStyle(.secondary)
            TextField("Email", text: $email).textContentType(.username)
            SecureField("Password", text: $password).textContentType(.password)
            Button(busy ? "Signing in…" : "Sign in") {
                busy = true
                Task { await workspace.login(email: email, password: password); password = ""; busy = false }
            }.buttonStyle(.glassProminent).disabled(busy || email.isEmpty || password.isEmpty)
        }.textFieldStyle(.roundedBorder).padding(35).frame(width: 390).glassEffect(.regular, in: .rect(cornerRadius: 24))
    }
}
struct ConnectionSettings: View {
    @Bindable var workspace: Workspace
    var body: some View {
        Form {
            Section("Local connection") {
                LabeledContent("Server", value: "http://127.0.0.1:5173")
                Text("Run Start Sentinel.command in the Sentinel folder before opening this app. Both interfaces share the existing database through the local server.").font(.caption).foregroundStyle(.secondary)
                Button("Reconnect") { Task { await workspace.refresh() } }
            }
            if workspace.account != "Local workspace" {
                Section("Account") {
                    LabeledContent("Signed in as", value: workspace.account)
                    Text("Your sign-in is remembered on this Mac.").font(.caption).foregroundStyle(.secondary)
                    Button("Sign out") { Task { await workspace.signOut() } }.disabled(workspace.loading)
                }
            }
            Section("Workspace") {
                Button("Export backup…") { Task { await workspace.exportBackup() } }.disabled(!workspace.connected)
                Button("Open workspace administration ↗") { workspace.openWeb("?view=admin") }
                Text("Field configuration, account management, backup import, and capture settings currently open in Sentinel web.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Appearance") {
                Text("Sentinel Dark · Native Liquid Glass").font(.callout)
                Text("Requires macOS 26 or later. Uses system transparency and accessibility preferences.").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).frame(width: 490, height: 450)
    }
}
