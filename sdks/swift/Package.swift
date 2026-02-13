// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AgentationMobile",
    platforms: [
        .iOS(.v16),
    ],
    products: [
        .library(
            name: "AgentationMobile",
            targets: ["AgentationMobile"]
        ),
    ],
    targets: [
        .target(
            name: "AgentationMobile",
            path: "Sources/AgentationMobile"
        ),
    ]
)
