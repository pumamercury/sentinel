# Move Sentinel to a Mac

Sentinel runs locally using React, Node.js and SQLite. No hosting account is required.
Verified on macOS with Node.js 24.19.0: all 10 integration tests, the TypeScript check,
the build, and loading the local workspace in a browser pass.

## Install the code

Install Git, Node.js **24**, and pnpm **10** on the Mac. If you use nvm, run `nvm install` in the cloned folder to use `.nvmrc`.

```sh
git clone <your-repository-url> Sentinel
cd Sentinel
node --version
pnpm install --frozen-lockfile
pnpm start
```

Open http://127.0.0.1:5173. Keep the Terminal window running. Ctrl+C stops Sentinel.
Install dependencies on the Mac: do not copy Windows `node_modules` or build output.

For a Finder launcher, run this once in the project folder, then double-click **Start Sentinel.command**:

```sh
chmod +x "Start Sentinel.command"
```

The Finder launcher also checks for Codex's bundled Node.js runtime when Node is
not available on your PATH or through nvm. This Mac uses that fallback; dependencies
were installed with bundled pnpm 11.19.0 using the frozen lockfile.

## Transfer your issues, pictures, attachments, and inbox

Git contains application code only. The ignored `data` folder contains your workspace.

1. In Windows, pause Attachment Inbox monitoring and stop Sentinel with Ctrl+C.
2. Copy the **entire `data` folder**, including `bugbook.sqlite`, any SQLite sidecar files, and `attachments`, to a private external drive or other trusted transfer location.
3. Stop Sentinel on the Mac if it is running. Place that folder inside the cloned Sentinel directory, beside `package.json`. Do not overwrite a Mac workspace you want to keep; back it up first.
4. Start Sentinel. Verify your project names, issue count, and an attachment preview.
5. In Attachment Inbox settings, select a Mac folder and enable monitoring when ready. The Windows iCloud Photos path does not exist on the Mac.

Keep the Windows copy until you have verified the migration. Do not commit the database or private backup exports to Git. Browser preferences such as sorting and page size are local to each browser and are not transferred with the database.

The Mac Photos library is not a normal watched folder. Use the Apple Photos integration below, or export captures into a dedicated folder such as `~/Pictures/Sentinel Captures` and enter its **full absolute path** in Folder settings. Folder monitoring requires locally downloaded files; Windows cloud-placeholder detection is Windows-specific.

## Connect Apple Photos

Build the native helper once on the Mac (requires Xcode or its command-line tools):

```sh
pnpm photos:build
```

In **Attachment Inbox → Apple Photos**, choose all photos and videos, photos only,
videos only, or screenshots only, then click **Connect Apple Photos**. Approve
the macOS Photos permission for **Sentinel Photos**. If denied, change it in
**System Settings → Privacy & Security → Photos**, then reconnect.

By default, the first connection records the existing library and skips it.
New items that become available in the Mac Photos library are collected afterward,
including items synced from iCloud. To import the older library too, enable
**Include existing library items**. This can download and duplicate a large amount
of media on disk. Changing filters does not reset the record of imported items.

The helper checks roughly every 15 seconds, downloads original resources through
PhotoKit as needed, and stages at most 10 files at a time. Sentinel imports the
queue every 5 seconds with its existing content-hash duplicate protection.
Each file is limited to 250 MB. Failed downloads retry after five minutes.
The helper reads originals only; it does not edit or delete Photos assets. Live
Photos import their still image, not the paired motion clip. HEIC/RAW and some
video codecs may require downloading to view. Hidden/Recently Deleted assets are
not requested, and limited Photos permission restricts what can be imported.

**Pause Photos import** stops new downloads and inbox ingestion; already queued
files wait until resumed. The browser may be closed, but Sentinel must stay
running. The helper exits after Sentinel stops (within 30 seconds if it crashes).
Only one workspace can use the helper at a time.

Native build output is ignored under `.macos/`. Photos settings, baseline, processed
asset identifiers and staging files live under `data/photos/`; copy the entire
`data` folder for a complete backup. JSON inbox backups include imported captures,
but do not transfer the Photos connection or native helper state. Build the helper
again after native source changes; macOS may request permission again.

## Verify and update

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

For later updates, stop Sentinel, run `git pull` and `pnpm install --frozen-lockfile`, then restart. Your ignored `data` folder remains local.

### Edited Photos

The inbox imports the full-size edited photo or video when Photos provides one, falling back to the original for unedited items. Later edits to monitored assets create a new inbox capture; existing captures and issue attachments are kept unchanged. Previously imported edited assets are exported once by the updated helper. Assets excluded by the initial “new items only” baseline remain excluded. Identical bytes are still deduplicated.
