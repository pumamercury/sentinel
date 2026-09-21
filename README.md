# Sentinel

A personal bug tracker that runs on your computer. Nothing is published or sent to an AI service.

The interface is built with React, with a dark theme and locally bundled DM Sans fonts. The upper-left Sentinel wordmark uses Roboto Mono. Project is the first table column with a larger avatar. Node.js runs the local server and SQLite database; React and Node serve different roles here.

## Start

Moving to another computer? See [macOS setup and workspace migration](docs/MACOS.md). Git transfers the application; copy your private `data` folder separately to transfer existing issues and attachments.

Double-click **Start Sentinel.cmd**, keep its window open, and open **http://127.0.0.1:5173** in your browser. Press Ctrl+C in the window to stop. If it reports that the port is in use, an existing copy may already be running at that address.

The launcher uses the Node.js runtime installed with Codex on this computer, or Node on your PATH. For another computer, install Node.js 24 or later and pnpm, then run `pnpm install` and `pnpm start`. The app uses a local Vite server; the generated cloud hosting scaffold is unused.

## Track bugs

Choose an **Issue type**: Bug, Idea, Task, or Feature request. Existing reports default to Bug. Each type has its own icon and display prefix (BUG, IDEA, TASK, FEAT); numeric IDs and detail URLs stay unchanged when changing types. Issue type is configurable in Admin like other select fields. The OLED glass theme uses #1400FF as its primary accent.

- Create, edit, and delete reports with a title, project, description, reproduction steps, expected and actual results, environment, affected version, labels, assignee, and due date.
- Choose priority, severity, and a workflow status: Open, In progress, In review, Resolved, or Closed.
- Switch between the list and status board. Click a bug title or card to open its dedicated `/bugs/ID` page, with organized report sections, properties, comments, and activity. New reports open this page automatically.
- Use **Edit bug** on the details page to update fields or delete the report. Saving returns to the updated details view.
- Search report content or BUG IDs; filter by project, status, and priority; sort by update time, creation time, or priority.
- Add comments and investigation notes. Changes to report fields appear in the activity history. Save report edits with **Save changes**; comments have their own **Add comment** button.
- Repro rate accepts values such as `3/5 attempts (60%)`; Component identifies an area such as Login or Payments.

## Projects and Admin

Open **Projects** for an overview with counts by configured issue type. Each project has a bookmarkable address, a complete issue list, type filters, and a New issue button that preselects the project. Issue details opened from a project link back to that project. Open **Admin → Projects** to create projects or edit their names, details, icons, and pictures. Existing project names from bugs appear automatically. Renaming a project updates all its linked bugs. Pictures appear beside the project in lists, boards, and bug details. Use PNG, JPEG, or WebP images up to 2 MB.

Open **Admin** to rename, reorder, show/hide, or require fields. Add custom text, multiline text, number, date, or select fields, then click **Save fields**. Title, project, status, and priority remain required to support the tracker. Every select field, including Status, Priority, and Severity, has an options editor in Admin. Enter one option per line and save. The bug form, filters, and status board use those choices. Options currently used by bugs cannot be removed until those bugs are reassigned. Priority options are ordered from lowest to highest for sorting. Existing field types cannot change: add a new field instead. Hidden values remain stored, searchable, and included in backups. Required visible fields must be filled when creating or editing a report. Admin has no password.

## Attachments

Screenshots and supported videos have clickable thumbnails. Click to open the centered, animated viewer; videos have playback, volume, fullscreen, and seek controls. Close with Escape, the close button, or the backdrop. PNG, JPEG, GIF, WebP, MP4, MOV, and WebM are recognized from file contents. Actual video playback depends on browser codec support; unsupported files keep a download option. The viewer respects reduced-motion settings.

Select attachments in the create/edit form; they upload when the report is saved. On the details page, the Attachments section can upload, download, and delete files. Supports up to 20 files per bug, 250 MB per file. Project pictures have a separate 2 MB limit. New attachments stream directly to the local `data/attachments` folder without compression; existing database attachments remain supported. Attachment metadata is stored in the local database with safe image/video previews and separate original-file downloads. Deleting a bug deletes its attachments.

If an upload fails after the report is saved, the report remains saved, successful uploads remain attached, and the remaining selected files can be retried with Save changes.

## Your data and backups

Reports remain stored in `data/bugbook.sqlite` (the legacy filename is preserved to retain existing data), independent of browser storage. Data persists across reloads and restarts. This folder is excluded from Git. Do not delete it.

New bugs use the lowest available positive number. If BUG-1 is deleted, that number can be used by the next new report. Existing bugs keep their numbers; the total counter counts only saved bugs. Reused numbers also reuse their `/bugs/ID` addresses. Sorting by creation time uses the actual timestamp, independently of numbering.

Use **Export backup** to download a JSON snapshot, including comments, history, attachments, project profiles/pictures, and field definitions. **Import backup** validates the whole file before adding anything. Import adds new records with new IDs; it does not replace existing bugs. Repeated imports create duplicates. Version 1 backups are still accepted. JSON export is available when combined attachments are at most 60 MB. Import limit: 100 MB; for larger workspaces, stop the app and copy the database folder instead.

Import preserves existing project profiles when names match. Into an empty workspace, field settings are restored; into an existing workspace, current settings are retained and new custom fields are added. Conflicting custom field definitions are rejected to avoid misinterpreting saved values.

To transfer the exact database, stop Sentinel first and copy the entire `data` folder. JSON export is preferable while the app is running.

## Current scope

This is a local application with no accounts, cloud sync, or AI integration. Anyone using the local workspace can manage projects and Admin settings. It binds to the loopback address. Do not expose the local development server to a network.

The React interface calls a small API in `server/api.mjs`. A future local AI integration can add suggestion endpoints there, with a preview and explicit acceptance before changing report text. No model or provider is configured yet.

## Development

- `pnpm dev` — run the local app
- `pnpm build` — compile the application
- `pnpm test` — exercise the API using an isolated temporary database
- `pnpm exec tsc --noEmit` — check types

The API tests cover editing, comments, persistence, backup import/export, atomic rejection of invalid imports, deletion, number reuse, cross-origin write rejection, migration of older reports, project renames and images, required/hidden custom fields, attachment limits, exact download bytes, and attachment cleanup. Build and type checks cover both page routes. Browser interaction testing and the optional WebMCP search tool require a compatible browser and were not part of these checks.

## Project workflows

- Change status and priority directly in issue lists and details. Drag board cards to a status column, or use the card’s status menu with keyboard/touch. Changes are recorded with old and new values.
- Admin → Issue fields includes status categories (Open, In progress, Completed) used for counts regardless of the status name.
- Fields can be scoped to selected issue types in Admin. By default, reproduction fields belong to Bugs, proposed solutions to Ideas/Features, and acceptance criteria to Tasks/Features. Hidden fields retain their values.
- Related issues supports relates to, blocks, and duplicates. Links appear on both issues, with direction-aware labels. Unlink from either side. Links are backed up, remapped during import, and removed when an issue is deleted.
- The workflow integration test also checks link cleanup when a deleted ID is reused, invalid imports, status categories, and scoped required fields.

## Attachment Inbox (iCloud captures)

Open **Attachment Inbox** in the sidebar. Its local capture agent runs inside the Sentinel server while Sentinel is running; the browser does not need to stay open. It is not a separate Windows tray app or startup service.

1. In **Folder settings**, enter your iCloud Photos folder (usually `C:\Users\your-name\Pictures\iCloud Photos\Photos`).
2. Choose extensions and optionally a filename filter, enable monitoring, and save. Defaults collect PNG, MP4, MOV, and M4V. File names/types cannot reliably distinguish screen recordings from camera videos.
3. Existing files are baselined and skipped. Newly appearing files are checked every 5 seconds, and their size/modification time must remain stable before import. Files added while Sentinel is stopped or monitoring is paused are picked up after it resumes.
4. Cloud-only files stay pending until iCloud downloads them. In Windows Explorer, use **Always keep on this device** for captures you want downloaded. Sentinel does not sign into iCloud or force downloads.
5. Preview captures, select up to 20, then **New issue with captures** or attach them to an existing issue. Closing the new-issue form leaves the captures in the inbox. Assignment removes them from the inbox after attaching them to the issue.

The importer copies files into Sentinel; it never moves, deletes, or changes iCloud originals. Content hashes prevent duplicates, including previously assigned or discarded captures. Files larger than 250 MB are skipped with an explanation. HEIC/HEIF can be collected if enabled, but browser previews may not be available. There is no automatic compression, screenshot classification, capture-session context, or automatic issue assignment in this first version.

Inbox files are included in JSON backups within the combined 60 MB attachment limit. For larger backups, stop Sentinel and copy the whole `data` folder. Watcher settings and the seen-file ledger live in the database; JSON import intentionally does not enable monitoring or copy another computer’s folder settings. Imported inbox captures are deduplicated by content.
