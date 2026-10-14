import SwiftUI

struct ProjectEditor: View {
    @Bindable var workspace: Workspace
    var project: JSONValue = .object([:])
    @State private var name = ""
    @State private var details = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(project["id"].int == 0 ? "New project" : "Edit project").font(.title2.weight(.semibold))
            TextField("Project name", text: $name).textFieldStyle(.roundedBorder)
            Text("Description").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $details).frame(height: 120).font(.body)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(busy ? "Saving…" : "Save project") { Task { await save() } }.buttonStyle(.glassProminent).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
            }
        }.padding(28).frame(width: 450).onAppear { name = project["name"].string; details = project["description"].string }
    }
    private func save() async {
        busy = true
        defer { busy = false }
        do {
            var body = project.object
            body["name"] = .string(name); body["description"] = .string(details)
            body["icon"] = .string(project["icon"].string.nonEmpty ?? "folder")
            body["image"] = .string(project["image"].string)
            let id = project["id"].int
            _ = try await workspace.api.request(id == 0 ? "projects" : "projects/\(id)", method: id == 0 ? "POST" : "PUT", body: .object(body))
            await workspace.refresh(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
