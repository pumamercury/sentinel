import SwiftUI
import AppKit

@main
struct SentinelApp: App {
    @NSApplicationDelegateAdaptor(SentinelApplicationDelegate.self) private var appDelegate
    @State private var workspace = Workspace()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup("Sentinel") {
            ContentView(workspace: workspace)
                .preferredColorScheme(.dark)
                .tint(.sentinel)
                .frame(minWidth: 1000, minHeight: 660)
                .task { await workspace.refresh() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await workspace.refresh() } } }
        }
        .defaultSize(width: 1440, height: 900)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Issue") { workspace.editor = .blank(fields: workspace.fields, project: workspace.project) }
                    .keyboardShortcut("n").disabled(!workspace.connected)
            }
            CommandGroup(after: .newItem) {
                Button("Refresh Workspace") { Task { await workspace.refresh() } }.keyboardShortcut("r")
                Button("Export Backup…") { Task { await workspace.exportBackup() } }.disabled(!workspace.connected)
            }
        }
        Settings { ConnectionSettings(workspace: workspace).preferredColorScheme(.dark) }
    }
}

extension Color {
    static let sentinel = Color(red: 0.29, green: 0.23, blue: 1)
    static let canvas = Color(red: 0.035, green: 0.039, blue: 0.055)
    static let panel = Color(red: 0.065, green: 0.071, blue: 0.095)
    static let muted = Color(red: 0.55, green: 0.58, blue: 0.67)
}

struct ContentView: View {
    @Bindable var workspace: Workspace
    @State private var visibility: NavigationSplitViewVisibility = .all
    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            sidebar.navigationSplitViewColumnWidth(min: 210, ideal: 235, max: 280)
        } detail: {
            ZStack {
                Color.canvas.ignoresSafeArea()
                if workspace.needsLogin {
                    LoginView(workspace: workspace)
                } else if !workspace.connected && workspace.issues.isEmpty {
                    ContentUnavailableView {
                        VStack(spacing: 16) { SentinelRobot().frame(width: 64, height: 64); Text(workspace.loading ? "Connecting to Sentinel" : "Your workspace, on your Mac").font(.title2.weight(.semibold)) }
                    } description: {
                        Text("Start the existing Sentinel server, then connect to use your issues, projects, and attachments.")
                    } actions: {
                        Button("Connect") { Task { await workspace.refresh() } }.buttonStyle(.glassProminent)
                        SettingsLink { Text("Connection settings") }
                    }
                } else if let issue = workspace.selectedIssue {
                    IssueDetail(workspace: workspace, issue: issue).id(issue.id)
                } else {
                    VStack(spacing: 0) {
                        pageHeader
                        if workspace.section == "Projects" { ProjectsView(workspace: workspace) }
                        else if workspace.section == "Attachment inbox" { InboxView(workspace: workspace) }
                        else { issuesContent }
                    }
                }
            }
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.stack.3d.up").foregroundStyle(Color.muted)
                        Text("Workspace").foregroundStyle(.secondary)
                        Text("/").foregroundStyle(.quaternary)
                        Text(workspace.project.nonEmpty ?? workspace.section).fontWeight(.medium)
                    }.font(.system(size: 12))
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { Task { await workspace.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .help("Refresh workspace (⌘R)").disabled(workspace.loading)
                    Button { workspace.editor = .blank(fields: workspace.fields, project: workspace.project) } label: {
                        Label("New issue", systemImage: "plus")
                    }.buttonStyle(.glassProminent).disabled(!workspace.connected)
                }
            }
        }
        .searchable(text: $workspace.query, placement: .toolbar, prompt: "Search issues")
        .sheet(item: $workspace.editor) { issue in IssueEditor(workspace: workspace, issue: issue) }
        .alert("Sentinel", isPresented: Binding(get: { workspace.error != nil }, set: { if !$0 { workspace.error = nil } })) {
            Button("OK") { workspace.error = nil }
        } message: { Text(workspace.error ?? "") }
        .onChange(of: workspace.section) { _, _ in Task { await workspace.refresh() } }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 11) {
                SentinelRobot().frame(width: 42, height: 42)
                Text("sentinel").font(.system(size: 24, weight: .semibold, design: .monospaced)).tracking(-1.6)
            }.padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 35)
            Text("WORKSPACE").font(.system(size: 10, weight: .semibold)).tracking(1.8).foregroundStyle(Color.muted).padding(.horizontal, 23).padding(.bottom, 12)
            nav("All issues", "square.stack", count: workspace.issues.count)
            nav("My issues", "person.crop.circle")
            nav("Projects", "square.grid.2x2")
            nav("Attachment inbox", "tray")
            nav("Trash", "trash")
            HStack { Text("PROJECTS"); Spacer(); Text("\(workspace.projects.count)") }
                .font(.system(size: 10, weight: .semibold)).tracking(1.5).foregroundStyle(Color.muted)
                .padding(.horizontal, 23).padding(.top, 34).padding(.bottom, 12)
            List(selection: Binding<String?>(
                get: { workspace.project.nonEmpty },
                set: { if let name = $0 { workspace.navigate("All issues", project: name) } }
            )) {
                ForEach(workspace.projects, id: \.self) { project in
                    HStack(spacing: 10) {
                        ProjectIcon(name: project["name"].string, size: 24, profile: project)
                        Text(project["name"].string).lineLimit(1)
                        Spacer(minLength: 0)
                    }.padding(.vertical, 5).frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .tag(project["name"].string)
                        .onTapGesture { workspace.navigate("All issues", project: project["name"].string) }
                }
            }.listStyle(.sidebar).scrollContentBackground(.hidden)
            Spacer(minLength: 24)
            VStack(alignment: .leading, spacing: 14) {
                Button { workspace.openWeb("?view=admin") } label: { Label("Workspace admin ↗", systemImage: "slider.horizontal.3") }.buttonStyle(.plain).foregroundStyle(.secondary)
                SettingsLink { Label("Settings", systemImage: "gearshape") }.buttonStyle(.plain).foregroundStyle(.secondary)
                Divider()
                HStack(spacing: 9) {
                    Circle().fill(workspace.connected ? Color.green : Color.orange).frame(width: 6, height: 6)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(workspace.connected ? "Local workspace" : "Disconnected").font(.system(size: 11, weight: .medium))
                        Text(workspace.account == "Local workspace" ? "Private. On your Mac." : workspace.account).font(.system(size: 10)).foregroundStyle(Color.muted).lineLimit(1)
                    }
                }
            }.padding(23)
        }.background(Color.black.opacity(0.2))
    }
    private func nav(_ title: String, _ icon: String, count: Int? = nil) -> some View {
        let active = workspace.section == title && workspace.project.isEmpty
        return Button { workspace.navigate(title) } label: {
            HStack(spacing: 11) {
                Image(systemName: icon).frame(width: 18)
                Text(title)
                Spacer()
                if let count { Text("\(count)").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary) }
            }.font(.system(size: 12, weight: active ? .semibold : .regular))
                .foregroundStyle(active ? .white : Color.muted)
                .padding(.horizontal, 12).padding(.vertical, 11)
                .frame(maxWidth: .infinity).contentShape(Rectangle())
                .background(active ? Color.sentinel.opacity(0.21) : .clear, in: RoundedRectangle(cornerRadius: 9))
                .overlay(alignment: .leading) { if active { Capsule().fill(Color.sentinel).frame(width: 3, height: 17) } }
        }.buttonStyle(.plain).padding(.horizontal, 12).padding(.vertical, 2)
    }
    private var pageHeader: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 7) {
                Text(workspace.project.nonEmpty ?? workspace.section).font(.system(size: 29, weight: .semibold)).tracking(-0.9)
                Text(subtitle).font(.system(size: 12)).foregroundStyle(Color.muted)
            }
            Spacer()
            if ["All issues", "My issues"].contains(workspace.section) {
                Picker("View", selection: $workspace.board) {
                    Image(systemName: "list.bullet").tag(false)
                    Image(systemName: "rectangle.split.3x1").tag(true)
                }.pickerStyle(.segmented).labelsHidden().frame(width: 88).help("List or board view")
            }
        }.padding(.horizontal, 30).padding(.top, 28).padding(.bottom, 25)
    }
    private var subtitle: String {
        switch workspace.section {
        case "Projects": "A home for everything you’re building."
        case "Attachment inbox": "Your captures, ready for their next issue."
        case "Trash": "Deleted issues stay here until you restore them."
        default: "A clear view of what needs your attention."
        }
    }
    private var issuesContent: some View {
        VStack(spacing: 0) {
            HStack(spacing: 22) {
                metric("Total issues", workspace.filtered.count, .white)
                metric("Open", workspace.filtered.filter { !workspace.completed($0) }.count, .sentinel)
                metric("Completed", workspace.filtered.filter { workspace.completed($0) }.count, .green)
                Spacer()
            }.padding(20).background(Color.panel, in: RoundedRectangle(cornerRadius: 14)).padding(.horizontal, 30).padding(.bottom, 22)
            HStack(spacing: 10) {
                filter("Status", value: $workspace.status, options: workspace.statuses)
                filter("Priority", value: $workspace.priority, options: workspace.options("priority"))
                if !workspace.status.isEmpty || !workspace.priority.isEmpty {
                    Button("Clear") { workspace.status = ""; workspace.priority = "" }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
                Spacer()
                Picker("Sort", selection: $workspace.sort) {
                    Text("Last updated").tag("Updated"); Text("Newest created").tag("Created"); Text("Priority").tag("Priority")
                }.labelsHidden().frame(width: 140)
                Text("\(workspace.filtered.count) issues").font(.system(size: 11)).foregroundStyle(Color.muted)
            }.padding(.horizontal, 30).padding(.bottom, 16)
            if workspace.filtered.isEmpty {
                ContentUnavailableView("No issues here", systemImage: "checkmark.circle", description: Text("Try another filter, or create a new issue."))
            } else if workspace.board && workspace.section != "Trash" { boardView }
            else { issueList }
        }
    }
    private func metric(_ name: String, _ value: Int, _ color: Color) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(color.opacity(0.8)).frame(width: 3, height: 31)
            VStack(alignment: .leading, spacing: 5) {
                Text(name).font(.system(size: 10)).foregroundStyle(Color.muted)
                Text("\(value)").font(.system(size: 24, weight: .medium, design: .rounded))
            }
        }.frame(minWidth: 115, alignment: .leading)
    }
    private func filter(_ title: String, value: Binding<String>, options: [String]) -> some View {
        Menu {
            Button("All \(title.lowercased())") { value.wrappedValue = "" }
            ForEach(options, id: \.self) { option in Button(option) { value.wrappedValue = option } }
        } label: {
            HStack(spacing: 7) { Image(systemName: title == "Status" ? "circle.dotted" : "line.3.horizontal.decrease"); Text(value.wrappedValue.nonEmpty ?? title); Image(systemName: "chevron.down").font(.system(size: 8)) }
                .font(.system(size: 11)).padding(.horizontal, 12).padding(.vertical, 8)
        }.menuStyle(.borderlessButton).fixedSize().glassEffect(.regular, in: .capsule)
    }
    private var issueList: some View {
        ScrollView {
            LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(workspace.filtered) { issue in
                        Button { if workspace.section != "Trash" { workspace.selection = issue.id } } label: {
                            IssueRow(issue: issue, selected: workspace.selection == issue.id, project: workspace.projectProfile(issue["project"]))
                        }.buttonStyle(.plain)
                            .contextMenu {
                                if workspace.section == "Trash" {
                                    Button("Restore issue", systemImage: "arrow.uturn.backward") { Task { await workspace.restore(issue) } }
                                } else {
                                    Button("Edit issue", systemImage: "pencil") { workspace.editor = issue }
                                    Menu("Change status") { ForEach(workspace.statuses, id: \.self) { status in Button(status) { Task { await workspace.changeStatus(issue, to: status) } } } }
                                    Button("Move to Trash", systemImage: "trash", role: .destructive) { Task { await workspace.moveToTrash(issue) } }
                                }
                            }
                        Divider().overlay(Color.white.opacity(0.015)).padding(.leading, 22)
                    }
                } header: {
                    HStack { Text("PROJECT").frame(width: 110, alignment: .leading); Text("ISSUE"); Spacer(); Text("STATUS").frame(width: 105, alignment: .leading); Text("PRIORITY").frame(width: 75, alignment: .leading) }
                        .font(.system(size: 9, weight: .semibold)).tracking(1.2).foregroundStyle(Color.muted)
                        .padding(.horizontal, 20).padding(.vertical, 13).background(Color.panel)
                }
            }
        }.background(Color.panel.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
            .clipShape(RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.055)))
            .padding(.horizontal, 30).padding(.bottom, 24)
    }
    private var boardView: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 16) {
                ForEach(workspace.statuses, id: \.self) { status in
                    VStack(alignment: .leading, spacing: 14) {
                        HStack { StatusBadge(status: status); Spacer(); Text("\(workspace.filtered.filter { $0["status"] == status }.count)").foregroundStyle(Color.muted) }.font(.system(size: 11)).padding(.horizontal, 4)
                        ScrollView {
                            LazyVStack(spacing: 10) {
                                ForEach(workspace.filtered.filter { $0["status"] == status }) { issue in
                                    Button { workspace.selection = issue.id } label: {
                                        VStack(alignment: .leading, spacing: 15) {
                                            HStack { Text(issue.label).font(.system(size: 10, design: .monospaced)).foregroundStyle(Color.muted); Spacer(); Image(systemName: issue.symbol).foregroundStyle(Color.muted) }
                                            Text(issue["title"]).font(.system(size: 13, weight: .medium)).multilineTextAlignment(.leading)
                                            HStack { ProjectIcon(name: issue["project"], size: 22, profile: workspace.projectProfile(issue["project"])); Text(issue["project"]).font(.system(size: 10)).lineLimit(1).foregroundStyle(Color.muted); Spacer(); PriorityBadge(priority: issue["priority"]) }
                                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Color.panel, in: RoundedRectangle(cornerRadius: 12))
                                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.07)))
                                    }.buttonStyle(.plain).draggable(String(issue.id))
                                }
                            }
                        }
                    }.padding(12).frame(width: 265).background(.white.opacity(0.018), in: RoundedRectangle(cornerRadius: 15))
                        .dropDestination(for: String.self) { ids, _ in
                            guard let id = ids.first.flatMap(Int.init), let issue = workspace.issues.first(where: { $0.id == id }) else { return false }
                            Task { await workspace.changeStatus(issue, to: status) }; return true
                        }
                }
            }.padding(.horizontal, 30).padding(.bottom, 24)
        }
    }
}

struct ProjectIcon: View {
    let name: String
    var size: CGFloat = 30
    var profile: JSONValue? = nil
    var body: some View {
        Group {
            if let image = ProjectArtwork.image(profile?["image"].string ?? "") {
                Image(nsImage: image).resizable().scaledToFill()
            } else if let icon = profile?["icon"].string.nonEmpty {
                Text(icon).font(.system(size: size * 0.58)).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Image(systemName: "macwindow").font(.system(size: size * 0.53)).foregroundStyle(Color.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.frame(width: size, height: size).background(.white.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: size * 0.25))
            .overlay(RoundedRectangle(cornerRadius: size * 0.25).strokeBorder(.white.opacity(0.1)))
            .accessibilityLabel(name + " project icon")
    }
}

@MainActor
enum ProjectArtwork {
    private static let cache: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>(); cache.countLimit = 100; return cache
    }()
    static func image(_ dataURL: String) -> NSImage? {
        guard !dataURL.isEmpty else { return nil }
        if let cached = cache.object(forKey: dataURL as NSString) { return cached }
        guard dataURL.hasPrefix("data:image/"), let comma = dataURL.firstIndex(of: ","),
              dataURL[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = NSImage(data: data) else { return nil }
        cache.setObject(image, forKey: dataURL as NSString)
        return image
    }
}
struct StatusBadge: View {
    let status: String
    private var color: Color {
        if ["Resolved", "Closed", "Done"].contains(status) { return .green }
        if status.localizedCaseInsensitiveContains("progress") { return .orange }
        if status.localizedCaseInsensitiveContains("review") { return .purple }
        return .muted
    }
    var body: some View {
        HStack(spacing: 6) { Image(systemName: color == .green ? "checkmark.circle.fill" : "circle.dotted").foregroundStyle(color); Text(status).foregroundStyle(.secondary) }.font(.system(size: 10)).lineLimit(1)
    }
}
struct PriorityBadge: View {
    let priority: String
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: priority == "Critical" ? "exclamationmark.2" : "chart.bar.fill")
                .foregroundStyle(priority == "Critical" ? .red : priority == "High" ? .orange : Color.muted)
            Text(priority).foregroundStyle(.secondary)
        }.font(.system(size: 10)).lineLimit(1)
    }
}
struct IssueRow: View {
    let issue: Issue
    let selected: Bool
    let project: JSONValue?
    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) { ProjectIcon(name: issue["project"], profile: project); Text(issue["project"]).font(.system(size: 11)).lineLimit(1) }.frame(width: 110, alignment: .leading)
            VStack(alignment: .leading, spacing: 5) {
                Text(issue["title"]).font(.system(size: 12, weight: .medium)).lineLimit(1)
                HStack(spacing: 6) { Image(systemName: issue.symbol); Text(issue.label).fontDesign(.monospaced); if !issue["component"].isEmpty { Text("·"); Text(issue["component"]) } }.font(.system(size: 10)).foregroundStyle(Color.muted)
            }
            Spacer(minLength: 12)
            StatusBadge(status: issue["status"]).frame(width: 105, alignment: .leading)
            PriorityBadge(priority: issue["priority"]).frame(width: 75, alignment: .leading)
        }.padding(.horizontal, 20).padding(.vertical, 16).contentShape(Rectangle())
            .background(selected ? Color.sentinel.opacity(0.13) : .clear)
    }
}

@MainActor
final class SentinelApplicationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Set the running Dock icon explicitly, even when Launch Services has
        // cached artwork from an earlier local build of this bundle.
        if let url = Bundle.main.url(forResource: "SentinelRobot", withExtension: "icns"),
           let icon = NSImage(contentsOf: url) {
            NSApplication.shared.applicationIconImage = icon
        }
    }
}
