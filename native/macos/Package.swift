// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Sentinel",
    platforms: [.macOS(.v26)],
    products: [.executable(name: "Sentinel", targets: ["Sentinel"])],
    targets: [
        .executableTarget(name: "Sentinel", resources: [.copy("Resources/SentinelRobot.svg")]),
        .testTarget(name: "SentinelTests", dependencies: ["Sentinel"])
    ]
)
