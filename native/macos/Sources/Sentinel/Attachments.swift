import SwiftUI
import AppKit

extension SentinelAPI {
    func upload(_ url: URL, issueID: Int) async throws {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 250_000_000 else { throw APIError(status: 413, message: "Each attachment must be at most 250 MB.") }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/bugs/\(issueID)/attachments"))
        request.httpMethod = "POST"
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(url.lastPathComponent.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-File-Name")
        let (data, response) = try await session.upload(for: request, fromFile: url)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            let error = try? JSONDecoder().decode(JSONValue.self, from: data)
            throw APIError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: error?["error"].string.nonEmpty ?? "Upload failed.")
        }
    }
    func download(_ path: String, to destination: URL) async throws {
        let (temporary, response) = try await session.download(from: baseURL.appendingPathComponent("api/" + path))
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw APIError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: "Unable to download the attachment.")
        }
        let data = try Data(contentsOf: temporary, options: .mappedIfSafe)
        try data.write(to: destination, options: .atomic)
    }
}

struct AttachmentActions: View {
    @Bindable var workspace: Workspace
    let issue: Issue
    @Binding var attachments: [JSONValue]
    @State private var busy = false
    @State private var preview: MediaItem?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("ATTACHMENTS").font(.system(size: 9, weight: .semibold)).tracking(1.3).foregroundStyle(Color.muted)
                Spacer()
                Button { Task { await upload() } } label: { Image(systemName: "plus") }.buttonStyle(.glass).help("Add attachments").disabled(busy)
            }
            if busy { ProgressView().controlSize(.small) }
            if attachments.isEmpty { Text("No attachments").font(.caption).foregroundStyle(.secondary) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 210, maximum: 360), spacing: 14)], spacing: 14) {
                ForEach(attachments, id: \.self) { file in
                    let item = MediaItem(file: file, path: "bugs/\(issue.id)/attachments/\(file["id"].string)")
                    VStack(alignment: .leading, spacing: 0) {
                        MediaThumbnail(workspace: workspace, item: item)
                            .contentShape(Rectangle()).onTapGesture { preview = item }
                            .accessibilityAddTraits(.isButton).accessibilityAction { preview = item }
                        HStack(spacing: 10) {
                            Button { preview = item } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item.name).font(.system(size: 12, weight: .medium)).lineLimit(2).multilineTextAlignment(.leading)
                                    Text(ByteCountFormatter.string(fromByteCount: Int64(file["size"].int), countStyle: .file)).font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(.plain)
                            Button { Task { await download(file) } } label: { Image(systemName: "arrow.down.circle") }.buttonStyle(.plain).help("Save original").disabled(busy)
                        }.padding(12)
                    }.background(Color.panel, in: RoundedRectangle(cornerRadius: 12)).clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.08)))
                }
            }
        }.sheet(item: $preview) { item in MediaPreview(workspace: workspace, item: item) }
    }
    private func upload() async {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        guard await panel.begin() == .OK else { return }
        busy = true
        defer { busy = false }
        do {
            for url in panel.urls { try await workspace.api.upload(url, issueID: issue.id) }
            attachments = try await workspace.api.request("bugs/\(issue.id)/attachments").array
            await workspace.refresh()
        } catch {
            // A partial upload remains visible and can be retried without resaving the issue.
            attachments = (try? await workspace.api.request("bugs/\(issue.id)/attachments").array) ?? attachments
            workspace.report(error)
        }
    }
    private func download(_ file: JSONValue) async {
        let panel = NSSavePanel(); panel.nameFieldStringValue = file["name"].string
        guard await panel.begin() == .OK, let destination = panel.url else { return }
        busy = true
        defer { busy = false }
        do { try await workspace.api.download("bugs/\(issue.id)/attachments/\(file["id"].string)", to: destination) }
        catch { workspace.report(error) }
    }
}
