import Foundation
import Testing
import AVFoundation
import CoreVideo
@testable import Sentinel

@Test(.enabled(if: ProcessInfo.processInfo.environment["SENTINEL_TEST_URL"] != nil))
func videoThumbnailAndPlayback() async throws {
    let address = ProcessInfo.processInfo.environment["SENTINEL_TEST_URL"]!
    let api = SentinelAPI(baseURL: URL(string: address)!)
    let session = try await api.request("auth/session")
    if session["enabled"].bool {
        _ = try await api.request("auth/login", method: "POST", body: .object(["email": .string("native-test@example.com"), "password": .string("Native test passphrase 123!")]))
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
    defer { try? FileManager.default.removeItem(at: url) }
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 32, AVVideoHeightKey: 32])
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: 32, kCVPixelBufferHeightKey as String: 32])
    writer.add(input)
    #expect(writer.startWriting())
    writer.startSession(atSourceTime: .zero)
    var buffer: CVPixelBuffer?
    #expect(CVPixelBufferCreate(kCFAllocatorDefault, 32, 32, kCVPixelFormatType_32ARGB, nil, &buffer) == kCVReturnSuccess)
    let frame = try #require(buffer)
    CVPixelBufferLockBaseAddress(frame, [])
    memset(CVPixelBufferGetBaseAddress(frame), 180, CVPixelBufferGetDataSize(frame))
    CVPixelBufferUnlockBaseAddress(frame, [])
    for second in 0..<2 {
        while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(10)) }
        #expect(adaptor.append(frame, withPresentationTime: CMTime(seconds: Double(second), preferredTimescale: 600)))
    }
    input.markAsFinished()
    await writer.finishWriting()
    #expect(writer.status == .completed)
    let fields = try await api.request("fields").array.map { Field(raw: $0) }
    var issue = Sentinel.Issue.blank(fields: fields, project: "Video preview regression")
    issue["title"] = "Video evidence"
    let created = try await api.request("bugs", method: "POST", body: .object(issue.values))
    let id = created["id"].int
    try await api.upload(url, issueID: id)
    let files = try await api.request("bugs/\(id)/attachments").array
    let file = try #require(files.first)
    let item = MediaItem(file: file, path: "bugs/\(id)/attachments/\(file["id"].string)")
    #expect(item.isVideo)
    let cache = MediaCache()
    let thumbnail = try await cache.thumbnail(for: item, api: api)
    #expect(thumbnail.width == 32 && thumbnail.height == 32)
    let local = try await cache.localURL(for: item, api: api)
    let playable = try await AVURLAsset(url: local).load(.isPlayable)
    #expect(playable)
}
