import SwiftUI
import AVKit
import ImageIO

struct MediaItem: Identifiable, Sendable {
    let file: JSONValue
    let path: String
    var id: String { path }
    var name: String { file["name"].string }
    var isVideo: Bool { file["previewType"].string == "video" || ["mov", "mp4", "m4v", "webm"].contains((name as NSString).pathExtension.lowercased()) }
}

/// One authenticated download per item, reused by thumbnails and the full viewer.
/// Originals live only in a private temporary directory for this app session.
actor MediaCache {
    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Sentinel-media-" + UUID().uuidString, isDirectory: true)
    private var downloads: [String: Task<URL, Error>] = [:]
    private var thumbnails: [String: CGImage] = [:]
    deinit { try? FileManager.default.removeItem(at: directory) }

    func localURL(for item: MediaItem, api: SentinelAPI) async throws -> URL {
        if let task = downloads[item.id] { return try await task.value }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let destination = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension((item.name as NSString).pathExtension)
        let task = Task {
            try await api.download(item.path, to: destination)
            return destination
        }
        downloads[item.id] = task
        do { return try await task.value }
        catch { downloads[item.id] = nil; throw error }
    }
    func thumbnail(for item: MediaItem, api: SentinelAPI) async throws -> CGImage {
        if let image = thumbnails[item.id] { return image }
        let url = try await localURL(for: item, api: api)
        let image: CGImage
        if item.isVideo {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 600, height: 600)
            image = try await generator.image(at: .zero).image
        } else {
            image = try Self.image(at: url, maximumSize: 600)
        }
        thumbnails[item.id] = image
        return image
    }
    static func image(at url: URL, maximumSize: Int) throws -> CGImage {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumSize
        ]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw APIError(status: 0, message: "This file format cannot be previewed. You can still save the original.")
        }
        return image
    }
}

struct MediaThumbnail: View {
    let workspace: Workspace
    let item: MediaItem
    @State private var thumbnail: CGImage?
    @State private var failure: String?
    @State private var attempt = 0
    var body: some View {
        ZStack {
            Color.black.opacity(0.3)
            if let thumbnail {
                Image(decorative: thumbnail, scale: 1).resizable().scaledToFit().padding(8)
                if item.isVideo {
                    Image(systemName: "play.circle.fill").font(.system(size: 36)).symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.65))
                }
            } else if failure != nil {
                VStack(spacing: 8) {
                    Image(systemName: item.isVideo ? "video.slash" : "photo.badge.exclamationmark").font(.title2)
                    Text("Preview unavailable").font(.caption)
                    Button("Retry") { attempt += 1 }.buttonStyle(.borderless)
                }.foregroundStyle(.secondary).help(failure ?? "")
            } else {
                VStack(spacing: 10) { ProgressView().controlSize(.small); Text("Loading preview…").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .frame(maxWidth: .infinity).frame(height: 180).clipped()
        .accessibilityLabel("\(item.isVideo ? "Video" : "Image") preview: \(item.name)")
        .task(id: "\(item.id)-\(attempt)") {
            failure = nil
            do {
                let image = try await workspace.media.thumbnail(for: item, api: workspace.api)
                try Task.checkCancellation()
                thumbnail = image
            } catch is CancellationError { }
            catch { failure = error.localizedDescription }
        }
    }
}

struct MediaPreview: View {
    let workspace: Workspace
    let item: MediaItem
    @Environment(\.dismiss) private var dismiss
    @State private var image: CGImage?
    @State private var player: AVPlayer?
    @State private var error: String?
    @State private var zoom = false
    @State private var saving = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Image(systemName: item.isVideo ? "film" : "photo").foregroundStyle(.secondary)
                Text(item.name).font(.headline).lineLimit(1).help(item.name)
                Spacer()
                if image != nil { Button(zoom ? "Fit to window" : "Zoom in", systemImage: zoom ? "arrow.down.right.and.arrow.up.left" : "plus.magnifyingglass") { zoom.toggle() }.buttonStyle(.glass) }
                Button("Save original", systemImage: "arrow.down.circle") { Task { await save() } }.buttonStyle(.glass).disabled(saving)
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.glass).keyboardShortcut(.cancelAction).help("Close preview")
            }.padding(18)
            Divider()
            GeometryReader { geometry in
                ZStack {
                    Color.black
                    if let player { VideoPlayer(player: player) }
                    else if let image {
                        if zoom {
                            ScrollView([.horizontal, .vertical]) {
                                Image(decorative: image, scale: 1).resizable().scaledToFit()
                                    .frame(width: max(geometry.size.width, CGFloat(image.width)), height: max(geometry.size.height, CGFloat(image.height)))
                            }
                        } else { Image(decorative: image, scale: 1).resizable().scaledToFit().frame(width: geometry.size.width, height: geometry.size.height) }
                    } else if let error {
                        ContentUnavailableView("Preview unavailable", systemImage: "doc", description: Text(error))
                    } else { ProgressView("Loading original…") }
                }
            }
            if let error, image != nil || player != nil { Text(error).font(.caption).foregroundStyle(.red).padding(10) }
        }.frame(minWidth: 640, idealWidth: 1040, maxWidth: .infinity, minHeight: 480, idealHeight: 780, maxHeight: .infinity)
            .task(id: item.id) {
                do {
                    let url = try await workspace.media.localURL(for: item, api: workspace.api)
                    try Task.checkCancellation()
                    if item.isVideo {
                        let asset = AVURLAsset(url: url)
                        guard try await asset.load(.isPlayable) else { throw APIError(status: 0, message: "This video codec is unsupported. Save the original to open it in another player.") }
                        player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
                    } else { image = try MediaCache.image(at: url, maximumSize: 8192) }
                } catch is CancellationError { }
                catch { self.error = error.localizedDescription }
            }
            .onDisappear { player?.pause(); player = nil }
    }
    private func save() async {
        let panel = NSSavePanel(); panel.nameFieldStringValue = item.name
        guard await panel.begin() == .OK, let destination = panel.url else { return }
        saving = true
        defer { saving = false }
        do { try await workspace.api.download(item.path, to: destination) }
        catch { self.error = error.localizedDescription }
    }
}
