import Foundation
import Testing
@testable import Sentinel

@MainActor @Test func selectingProjectLeavesIssueAndClearsHiddenFilters() {
    let workspace = Workspace()
    workspace.issues = [
        Issue(values: ["id": .number(1), "title": .string("First"), "project": .string("Buff")]),
        Issue(values: ["id": .number(2), "title": .string("Second"), "project": .string("HomeHero")])
    ]
    workspace.section = "Trash"
    workspace.selection = 2
    workspace.query = "unrelated search"
    workspace.priority = "Critical"
    workspace.status = "Closed"
    workspace.navigate("All issues", project: "buff")
    #expect(workspace.selection == nil)
    #expect(workspace.section == "All issues")
    #expect(workspace.query.isEmpty && workspace.status.isEmpty && workspace.priority.isEmpty)
    #expect(workspace.filtered.map(\.id) == [1])
    workspace.navigate("All issues", project: "HomeHero")
    #expect(workspace.filtered.map(\.id) == [2])
}

@MainActor @Test func projectArtworkUsesWebProfile() throws {
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII="
    let workspace = Workspace()
    workspace.projects = [.object(["id": .number(1), "name": .string("Buff"), "image": .string(png), "icon": .string("🤖")])]
    let profile = try #require(workspace.projectProfile("BUFF"))
    #expect(profile["icon"].string == "🤖")
    let image = try #require(ProjectArtwork.image(profile["image"].string))
    #expect(image.size.width == 1 && image.size.height == 1)
    #expect(ProjectArtwork.image("data:image/png;base64,invalid") == nil)
    #expect(ProjectArtwork.image("https://example.com/image.png") == nil)
}
