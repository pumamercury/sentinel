import SwiftUI

struct IssueEditor: View {
    @Bindable var workspace: Workspace
    @State var issue: Issue
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDiscard = false
    @State private var original: Issue?
    @State private var saveError: String?
    private var applicable: [Field] { workspace.fields.filter { $0.applies(to: issue["issueType"]) } }
    private func value(_ field: Field) -> Binding<String> {
        Binding(get: { field.builtin ? issue[field.id] : issue.values["customFields"]?[field.id].string ?? "" }, set: { newValue in
            if field.builtin { issue[field.id] = newValue }
            else { var custom = issue.values["customFields"]?.object ?? [:]; custom[field.id] = .string(newValue); issue.values["customFields"] = .object(custom) }
        })
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(issue.id == 0 ? "New issue" : "Edit \(issue.label)").font(.title2.weight(.semibold))
                    Text("Give the next step a little clarity.").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { cancel() } label: { Image(systemName: "xmark") }.buttonStyle(.glass).help("Close editor")
            }.padding(24)
            Divider()
            Form {
                ForEach(applicable) { field in
                    Section {
                        if field.type == "textarea" {
                            TextEditor(text: value(field)).font(.body).frame(minHeight: 90).scrollContentBackground(.hidden)
                        } else if field.type == "select" && !field.options.isEmpty {
                            Picker(field.label, selection: value(field)) {
                                if !field.required { Text("None").tag("") }
                                ForEach(Array(Set(field.options + (value(field).wrappedValue.isEmpty ? [] : [value(field).wrappedValue]))).sorted(), id: \.self) { option in Text(option).tag(option) }
                            }.labelsHidden()
                        } else {
                            HStack {
                                TextField(field.type == "date" ? "YYYY-MM-DD" : field.label, text: value(field))
                                if field.id == "project" {
                                    Menu { ForEach(workspace.projects, id: \.self) { project in Button(project["name"].string) { issue["project"] = project["name"].string } } } label: { Image(systemName: "chevron.down") }.fixedSize()
                                }
                            }
                        }
                    } header: { Text(field.label + (field.required ? " *" : "")) }
                }
            }.formStyle(.grouped)
            Divider()
            if let saveError { Text(saveError).font(.caption).foregroundStyle(.red).padding(.horizontal, 20).padding(.top, 12) }
            HStack {
                Text("Saved to your local Sentinel workspace").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { cancel() }.keyboardShortcut(.cancelAction)
                Button(workspace.saving ? "Saving…" : "Save issue") {
                    Task { if await workspace.save(issue) { dismiss() } else { saveError = workspace.error; workspace.error = nil } }
                }.buttonStyle(.glassProminent).keyboardShortcut("s")
                    .disabled(workspace.saving || issue["title"].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || issue["project"].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding(20)
        }.frame(width: 640, height: 760).interactiveDismissDisabled()
            .onAppear { original = issue }
            .confirmationDialog("Discard your unsaved changes?", isPresented: $confirmDiscard) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
    }
    private func cancel() { if original != issue { confirmDiscard = true } else { dismiss() } }
}

struct IssueDetail: View {
    @Bindable var workspace: Workspace
    let issue: Issue
    @State private var comment = ""
    @State private var commenting = false
    @State private var attachments: [JSONValue] = []
    @State private var deleteConfirmation = false
    @State private var loadingAttachments = true
    @State private var attachmentError: String?
    private let primaryKeys = ["title", "project", "status", "priority", "assignee", "issueType", "dueDate"]
    private var reportFields: [Field] { workspace.fields.filter { $0.applies(to: issue["issueType"]) && $0.type == "textarea" && !primaryKeys.contains($0.id) } }
    private var extraProperties: [Field] { workspace.fields.filter { $0.applies(to: issue["issueType"]) && $0.type != "textarea" && !primaryKeys.contains($0.id) } }
    private func fieldText(_ field: Field) -> String { field.builtin ? issue[field.id] : issue.values["customFields"]?[field.id].string ?? "" }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Button { workspace.selection = nil } label: { Label("Back to " + (workspace.project.nonEmpty ?? workspace.section).lowercased(), systemImage: "arrow.left") }
                        .buttonStyle(.glass).keyboardShortcut("[", modifiers: .command)
                    Spacer()
                    Label(issue.label, systemImage: issue.symbol).font(.system(size: 12, design: .monospaced)).foregroundStyle(Color.muted)
                    Button("Edit issue", systemImage: "pencil") { workspace.editor = issue }.buttonStyle(.glass)
                }
                VStack(alignment: .leading, spacing: 16) {
                    Text(issue["title"]).font(.system(size: 32, weight: .semibold)).tracking(-0.6).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 12) { ProjectIcon(name: issue["project"], size: 28, profile: workspace.projectProfile(issue["project"])); Text(issue["project"]).font(.callout).foregroundStyle(.secondary); StatusBadge(status: issue["status"]); PriorityBadge(priority: issue["priority"]) }
                }
                Divider()
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 30) {
                        report.frame(minWidth: 460, maxWidth: .infinity, alignment: .leading)
                        properties.frame(width: 260)
                    }
                    VStack(alignment: .leading, spacing: 26) { properties; report }
                }
            }.padding(32).frame(maxWidth: 1320, alignment: .leading).frame(maxWidth: .infinity)
        }.background(Color.canvas)
            .task(id: issue["updatedAt"]) { await loadAttachments() }
            .confirmationDialog("Move \(issue.label) to Trash?", isPresented: $deleteConfirmation) {
                Button("Move to Trash", role: .destructive) { Task { await workspace.moveToTrash(issue) } }
            } message: { Text("You can restore it from Trash.") }
    }
    private var properties: some View {
        VStack(alignment: .leading, spacing: 19) {
            Text("PROPERTIES").font(.system(size: 10, weight: .semibold)).tracking(1.3).foregroundStyle(Color.muted)
            HStack {
                Text("Status").foregroundStyle(Color.muted); Spacer()
                Menu { ForEach(workspace.statuses, id: \.self) { status in Button(status) { Task { await workspace.changeStatus(issue, to: status) } } } } label: { StatusBadge(status: issue["status"]) }.menuStyle(.borderlessButton).fixedSize()
            }
            HStack { Text("Priority").foregroundStyle(Color.muted); Spacer(); PriorityBadge(priority: issue["priority"]) }
            property("Assignee", issue["assignee"].nonEmpty ?? "Unassigned")
            property("Type", issue["issueType"])
            if !issue["dueDate"].isEmpty { property("Due date", issue["dueDate"]) }
            Divider()
            ForEach(extraProperties) { field in
                if !fieldText(field).isEmpty { property(field.label, fieldText(field)) }
            }
            Divider()
            Button("Move to Trash", systemImage: "trash", role: .destructive) { deleteConfirmation = true }.buttonStyle(.plain)
        }.font(.system(size: 12)).padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Color.panel, in: RoundedRectangle(cornerRadius: 14))
    }
    private var report: some View {
        VStack(alignment: .leading, spacing: 28) {
            // Evidence is visible immediately, rather than buried beneath all report fields.
            if loadingAttachments { ProgressView("Loading attachments…").font(.caption) }
            if let attachmentError {
                HStack { Text(attachmentError).font(.caption).foregroundStyle(.secondary); Button("Retry") { Task { await loadAttachments() } } }
            }
            AttachmentActions(workspace: workspace, issue: issue, attachments: $attachments)
            Divider()
            ForEach(reportFields) { field in
                if !fieldText(field).isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(field.label).font(.system(size: 16, weight: .semibold))
                        Text(fieldText(field)).font(.system(size: 14)).lineSpacing(6).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            Divider()
            Text("Activity").font(.system(size: 18, weight: .semibold))
            ForEach(Array((issue.values["comments"]?.array ?? []).enumerated()), id: \.offset) { _, entry in
                VStack(alignment: .leading, spacing: 9) {
                    Text(entry["actor"]["email"].string.nonEmpty ?? "Workspace member").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    Text(entry["text"].string).font(.system(size: 14)).textSelection(.enabled)
                    Text(entry["at"].string.prefix(16).replacingOccurrences(of: "T", with: " · ")).font(.system(size: 10)).foregroundStyle(Color.muted)
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Color.panel, in: RoundedRectangle(cornerRadius: 10))
            }
            TextField("Add an investigation note…", text: $comment, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
            HStack { Spacer(); Button(commenting ? "Adding…" : "Add comment") { Task { await addComment() } }.buttonStyle(.glass).disabled(comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || commenting) }
            DisclosureGroup("Change history") {
                ForEach(Array((issue.values["history"]?.array ?? []).reversed().enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 4) { Text(entry["text"].string).font(.caption); Text(entry["at"].string).font(.system(size: 10)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
                }
            }.font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func loadAttachments() async {
        loadingAttachments = attachments.isEmpty
        attachmentError = nil
        defer { loadingAttachments = false }
        do { attachments = try await workspace.api.request("bugs/\(issue.id)/attachments").array }
        catch is CancellationError { }
        catch { attachmentError = error.localizedDescription }
    }
    private func property(_ name: String, _ value: String) -> some View {
        HStack { Text(name).foregroundStyle(Color.muted); Spacer(minLength: 12); Text(value).multilineTextAlignment(.trailing).textSelection(.enabled) }
    }
    private func addComment() async {
        commenting = true
        defer { commenting = false }
        do {
            _ = try await workspace.api.request("bugs/\(issue.id)/comments", method: "POST", body: .object(["text": .string(comment)]))
            comment = ""; await workspace.refresh()
        } catch { workspace.report(error) }
    }
}
