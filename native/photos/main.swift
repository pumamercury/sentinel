import AppKit
import Photos
import Foundation
import CryptoKit
import Darwin

// A separate app bundle gives Photos permission a stable, visible identity.
// It only reads PhotoKit resources; no performChanges calls are made.
let fm = FileManager.default
guard CommandLine.arguments.count > 1 else { exit(1) }
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let queue = root.appendingPathComponent("queue", isDirectory: true)
try fm.createDirectory(at: queue, withIntermediateDirectories: true)
let lockFD = Darwin.open(root.appendingPathComponent("helper.lock").path, O_CREAT | O_RDWR, 0o600)
guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { exit(0) }

@Sendable func readJSON(_ url: URL) -> [String: Any] {
    guard let data = try? Data(contentsOf: url), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return object
}
@Sendable func writeJSON(_ object: [String: Any], _ url: URL) throws {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]).write(to: url, options: .atomic)
}
@Sendable func config() -> [String: Any] { readJSON(root.appendingPathComponent("config.json")) }
func active() -> Bool {
    let c = config()
    let lease = readJSON(root.appendingPathComponent("lease.json"))["at"] as? Double ?? 0
    return c["enabled"] as? Bool == true && Date().timeIntervalSince1970 - lease < 30
}
var completed = readJSON(root.appendingPathComponent("ledger.json"))
var failures: [String: Date] = [:]
var problem = ""
func status(_ state: String, _ message: String = "") {
    try? writeJSON(["state": state, "message": message, "problem": problem,
                    "updatedAt": ISO8601DateFormatter().string(from: Date()),
                    "processed": completed.count], root.appendingPathComponent("status.json"))
}

func exportResource(_ resource: PHAssetResource, to url: URL) throws {
    fm.createFile(atPath: url.path, contents: nil)
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = true
    let finished = DispatchSemaphore(value: 0)
    let mutex = NSLock()
    var bytes = 0
    var failure: Error?
    let manager = PHAssetResourceManager.default()
    let request = manager.requestData(for: resource, options: options, dataReceivedHandler: { data in
        mutex.lock(); defer { mutex.unlock() }
        guard failure == nil else { return }
        bytes += data.count
        if bytes > 250_000_000 {
            failure = NSError(domain: "Sentinel", code: 413, userInfo: [NSLocalizedDescriptionKey: "File exceeds 250 MB."])
            return
        }
        do { try handle.write(contentsOf: data) } catch { failure = error }
    }, completionHandler: { error in
        mutex.lock()
        if failure == nil { failure = error }
        mutex.unlock()
        finished.signal()
    })
    let deadline = Date().addingTimeInterval(600)
    while finished.wait(timeout: .now() + 0.5) == .timedOut {
        mutex.lock(); let failed = failure != nil; mutex.unlock()
        if failed || !active() || Date() > deadline {
            mutex.lock()
            if failure == nil { failure = NSError(domain: "Sentinel", code: 1, userInfo: [NSLocalizedDescriptionKey: "Import cancelled."]) }
            mutex.unlock()
            manager.cancelDataRequest(request)
            // Wait for PhotoKit to finish before closing the file handle.
            _ = finished.wait(timeout: .now() + 10)
            throw NSError(domain: "Sentinel", code: 1, userInfo: [NSLocalizedDescriptionKey: failed ? "File exceeds 250 MB or could not be written." : "Import paused or iCloud download timed out; will retry."])
        }
    }
    if let failure = failure { throw failure }
    if bytes == 0 { throw NSError(domain: "Sentinel", code: 2, userInfo: [NSLocalizedDescriptionKey: "Empty resource; will retry."]) }
}

func scan() {
    let c = config()
    let scope = c["scope"] as? String ?? "all"
    let options = PHFetchOptions()
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    if scope == "photos" || scope == "screenshots" {
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    } else if scope == "videos" {
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.video.rawValue)
    }
    let assets = PHAsset.fetchAssets(with: options)
    let baselineURL = root.appendingPathComponent("baseline.json")
    var baseline = readJSON(baselineURL)
    if c["includeExisting"] as? Bool != true && baseline["initialized"] == nil {
        // Baseline the entire library, so changing a filter does not import old items.
        var ids: [String: Bool] = [:]
        PHAsset.fetchAssets(with: nil).enumerateObjects { asset, _, _ in ids[asset.localIdentifier] = true }
        baseline = ["initialized": true, "ids": ids]
        do { try writeJSON(baseline, baselineURL) } catch { status("error", error.localizedDescription); return }
    }
    let skipped = c["includeExisting"] as? Bool == true ? [:] : (baseline["ids"] as? [String: Bool] ?? [:])
    var count = 0
    assets.enumerateObjects { asset, _, stop in
        if !active() { stop.pointee = true; return }
        let queued = (try? fm.contentsOfDirectory(atPath: queue.path).filter { $0.hasSuffix(".json") }.count) ?? 0
        if queued >= 10 || count >= 20 { stop.pointee = true; return }
        if skipped[asset.localIdentifier] == true { return }
        if scope == "screenshots" && !asset.mediaSubtypes.contains(.photoScreenshot) { return }
        let key = SHA256.hash(data: Data(asset.localIdentifier.utf8)).map { String(format: "%02x", $0) }.joined()
        // Do not replace a queued export while Sentinel is still ingesting it.
        if fm.fileExists(atPath: queue.appendingPathComponent(key + ".json").path) { return }
        if let failureDate = failures[key], Date().timeIntervalSince(failureDate) < 300 { return }
        let resources = PHAssetResource.assetResources(for: asset)
        let editedType: PHAssetResourceType = asset.mediaType == .video ? .fullSizeVideo : .fullSizePhoto
        let originalType: PHAssetResourceType = asset.mediaType == .video ? .video : .photo
        let edited = resources.first(where: { $0.type == editedType })
        guard let resource = edited ?? resources.first(where: { $0.type == originalType }) else { return }
        let revision = String((asset.modificationDate ?? asset.creationDate ?? Date.distantPast).timeIntervalSince1970) + ":" + String(resource.type.rawValue)
        if completed[key] as? String == revision { return }
        // Older helpers recorded only true. Re-export already edited assets once;
        // baseline exclusions still prevent importing the pre-existing library.
        if completed[key] as? Bool == true && edited == nil {
            completed[key] = revision
            try? writeJSON(completed, root.appendingPathComponent("ledger.json"))
            return
        }
        // Keep compatibility with pre-macOS-27 SDKs as well.
        let filename = resource.originalFilename
        let part = queue.appendingPathComponent(key + ".part")
        let output = queue.appendingPathComponent(key + ".media")
        status("importing", filename)
        do {
            try exportResource(resource, to: part)
            if fm.fileExists(atPath: output.path) { try fm.removeItem(at: output) }
            try fm.moveItem(at: part, to: output)
            try writeJSON(["name": filename, "assetId": asset.localIdentifier,
                           "modified": ISO8601DateFormatter().string(from: asset.modificationDate ?? asset.creationDate ?? Date())],
                          queue.appendingPathComponent(key + ".json"))
            completed[key] = revision
            try writeJSON(completed, root.appendingPathComponent("ledger.json"))
            failures.removeValue(forKey: key)
            count += 1
        } catch {
            try? fm.removeItem(at: part)
            failures[key] = Date()
            problem = filename + ": " + error.localizedDescription
        }
    }
    status("watching", "Watching Apple Photos for matching items.")
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.global(qos: .utility).async {
    while active() {
        let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if authorization == .notDetermined {
            status("permission", "Allow Sentinel Photos to read your library in the macOS permission dialog.")
            let semaphore = DispatchSemaphore(value: 0)
            DispatchQueue.main.async {
                app.activate(ignoringOtherApps: true)
                PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in semaphore.signal() }
            }
            while semaphore.wait(timeout: .now() + 1) == .timedOut {
                if !active() { break }
            }
        } else if authorization == .authorized || authorization == .limited {
            scan()
        } else {
            status("denied", "Enable Sentinel Photos in System Settings → Privacy & Security → Photos, then reconnect.")
        }
        for _ in 0..<15 { if !active() { break }; Thread.sleep(forTimeInterval: 1) }
    }
    status("paused", "Photos import paused.")
    DispatchQueue.main.async { app.terminate(nil) }
}
app.run()
