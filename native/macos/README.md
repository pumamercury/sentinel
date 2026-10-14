# Sentinel for macOS

A native SwiftUI client for the existing Sentinel workspace, targeting **macOS 26+**. It keeps the dark canvas, blue-violet accent, compact issue rows, project-first layout, and monospaced issue IDs. Navigation uses a native split view and full-page issue details; toolbars, filter menus, and primary actions use Apple’s Liquid Glass APIs. No WebView, third-party packages, or separate database.

## Open the app

Double-click **Open Sentinel.command**. It builds the app if necessary, starts the existing Sentinel launcher if the server is unavailable, and opens `output/Sentinel.app`. On first launch, press Connect if the server is still starting.

To build manually (Xcode 26+ with Swift 6.2+):

```sh
cd native/macos
./build-app.sh
open output/Sentinel.app
```

The app is locally ad-hoc signed, not notarized for distribution. Keep the existing Sentinel server running at `http://127.0.0.1:5173`. The native and browser apps share the same data through the API. This is a native frontend, not yet a standalone replacement for the Node backend. The app never directly opens or migrates your SQLite database.

Open `Package.swift` in Xcode to work on the app. No external Swift packages are required.

## Native features

- All issues and assigned-to-me views, full-content search, configured status/priority filters, and sorting.
- List and board layouts; drag cards between workflow columns or use the issue status menu.
- Project overview, project filtering, creation, and editing (right-click a project card).
- Create and edit reports using the server’s field definitions, including scoped and custom fields. Unshown values are preserved.
- Full-page issue details with a back button, properties, report sections, comments, and change history.
- Original Sentinel robot artwork in the sidebar, sign-in screen, and Dock icon.
- Native attachment selection, streaming upload, and save dialogs for downloads. Image and video thumbnails open a large native viewer with image zoom and video playback controls.
- Attachment inbox thumbnail grid with previews before assignment to an existing issue. Media uses the signed-in API session; thumbnail and viewer downloads are shared in a temporary session cache.
- Move issues to Trash and restore them using the row context menu.
- Account sign-in using the existing authentication service. Sessions stay in the native app’s ephemeral cookie store; no passwords are saved.
- Export JSON backups through a native save dialog.
- ⌘N to create, ⌘R to refresh, ⌘S to save an issue. Refreshes when the app becomes active.

## Remaining parity work

Advanced field/account administration, backup import, and capture settings open the existing browser interface. Attachment deletion, related-issue editing, project image uploads, and persisted report drafts are not implemented yet. Project avatars use the same saved image or emoji as the web app, with a window icon when neither is configured. “My issues” uses the signed-in email; local workspaces without accounts have no personal identity. No offline editing, bundled server, automatic updates, or distribution signing is included.

## Validation

```sh
swift test
```

The integration test is explicitly skipped unless `SENTINEL_TEST_URL` is set. To test the real API without touching personal data:

1. With Node.js 24+ available, run `node scripts/test-server.mjs` from this directory. It prints a loopback URL and creates a temporary SQLite database.
2. In another terminal, run `SENTINEL_TEST_URL=http://127.0.0.1:PORT swift test` with the printed port.
3. Stop the test server with Ctrl+C to remove its temporary database.

Tests cover preservation of unknown/custom fields, configured field scope/defaults, and an actual API round trip for create/edit/status/comments, exact attachment upload/download bytes, trash/restore, and backup export. These are API/model tests, not automated UI tests.

Run the test server with `--authenticated` to verify image thumbnails, inbox previews, and video playback with a temporary signed-in account. Media tests also verify that unauthenticated requests are denied. After rebuilding, quit and reopen Sentinel to load the updated app.
