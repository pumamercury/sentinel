import SwiftUI
import AppKit

struct SentinelRobot: View {
    private static let image: NSImage = {
        // Packaged app and SwiftPM/Xcode runs both use the original web artwork.
        let url = Bundle.main.url(forResource: "SentinelRobot", withExtension: "svg")
            ?? Bundle.module.url(forResource: "SentinelRobot", withExtension: "svg")!
        return NSImage(contentsOf: url)!
    }()
    var body: some View {
        Image(nsImage: Self.image).resizable().scaledToFit().accessibilityLabel("Sentinel robot")
    }
}
