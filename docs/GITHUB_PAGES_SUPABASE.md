# GitHub Pages and Supabase

Sentinel has separate local and hosted builds. The hosted build uses Supabase Auth, an authenticated Edge API, Postgres and a private Storage bucket. The local Mac workspace remains available with its original SQLite data.

## Hosted build and deployment

`pnpm build:pages` builds only the web client into `dist-pages/`. `hosted/supabase.json` contains the public project URL and publishable API key; it contains no server credential. `.github/workflows/pages.yml` tests and publishes that directory on pushes to `main`.

The target address is `https://pumamercury.github.io/sentinel/`. Query routes such as `/sentinel/?issue=12` support direct visits and refreshes without server rewrites. The GitHub repository remains private; Pages must be available on its GitHub plan and enabled for GitHub Actions.

The backend is the Sentinel project `ymipxchbwewwouajoutx` in the Sentinel Supabase organization, region `eu-west-1` (Ireland). The `sentinel-api` Edge Function implements the hosted API. Requests validate the Supabase user and current invited membership; disabling a member takes effect on subsequent API calls. Public table access is revoked and RLS denies direct client access. Writes use a version-checked Postgres function so concurrent requests cannot overwrite each other’s committed state. Functions are invoker-security and callable only by the server role.

The workspace is stored as a versioned JSONB document, matching the existing small-workspace application model. Files are separate private Storage objects. This deliberately favors atomic cross-issue updates and migration fidelity; a large-workspace redesign should normalize records and introduce server-side pagination before approaching the 20 MB document limit.

## Owner access and invitations

Migration creates an owner setup link and saves it privately under `migration-private/…/owner-access.json`. Open the link and choose a password; local passwords and sessions are not copied. Invitations are generated as links to share explicitly, rather than automatically emailing people.

The Edge Function has JWT gateway verification disabled because it performs its own Auth `getUser` verification and also supports scoped Mac companion credentials. Browser requests still require an actual authenticated, active invited user. Migration routes additionally require an expiring, hashed token and become unavailable when migration finishes. No service-role key is included in the client.

Supabase's security advisor reports intentional deny-all RLS tables as informational notices. Its Free Auth configuration does not enable leaked-password checking; password length is enforced by the account interface and Supabase's own password rules.

## Mac Photos companion

The Mac Photos helper continues collecting new and edited Photos items locally. When `data/cloud-connection.json` exists, `Start Sentinel.command` also runs `scripts/cloud-companion.mjs`. Every 30 seconds it uploads unseen captures into the hosted inbox using a scoped, expiring credential. It cannot edit issues or manage accounts. Originals remain in Photos and the local inbox. Discarded captures are remembered so they are not repeatedly uploaded.

Run `pnpm cloud:companion -- --once` for one sync. `data/cloud-status.json` records the last result and per-file problems. The current companion credential expires after 90 days and must then be replaced. Local issue edits do not automatically sync to the hosted workspace; use the hosted site for shared issue work.

Supported images/videos from the Mac are compressed before cloud upload. Direct web uploads optimize supported still images at full resolution, keeping the original if smaller; direct web videos retain their original quality. Animated images are retained. The current hosted bucket limit is 50 MB per file. Private media URLs expire after 15 minutes and the UI refreshes them.

## Migration and backups

`node scripts/prepare-cloud-migration.mjs` produces a private export in ignored `migration-private/`. It preserves IDs, Trash, activity, prefixes/counters, components/versions, custom fields, relationships and file bytes with SHA-256 hashes. Account metadata is included, but password hashes, session tokens and local Photos paths are excluded.

`scripts/migrate-to-supabase.mjs` uploads and reads back each file for checksum verification. Its one-time migration credential, temporary access-test accounts and owner setup links stay in ignored private files. Never include `data/`, `migration-private/`, `.macos/`, or test screenshots in a Git commit or Pages artifact.

Browser backup export downloads files directly from Storage before generating the JSON backup (up to 250 MB of media). Web backup imports currently support up to 19 MB; larger transfers use the migration tools. Project CSV exports remain available for date-range data transfers.

On 2026-10-14 the source snapshot contains 14 issues, 5 projects and 51 files (145,962,162 bytes). The local data stays intact throughout migration.

## Verification

- `pnpm test`: local API, compression, migration export, Pages routing and cloud domain tests.
- `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm build:pages`.
- `scripts/check-cloud-access.mjs`: temporary live-account checks for unauthenticated/outsider rejection, owner/member restrictions, private storage, edits, conflicts, comments, Trash, CSV and immediate membership revocation.
- `scripts/check-pages-browser.mjs`: production-build browser smoke test using isolated temporary credentials. Set `PLAYWRIGHT_MODULE` to a Playwright installation if it is not on the module path.

Remove temporary test accounts with the migration tool before finalizing migration. The live test restores its initial workspace snapshot while the workspace is still unpublished, so do not run it after inviting real users.
