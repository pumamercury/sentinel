# Private workspace accounts

Sentinel supports one owner and invited members sharing a workspace. Every member
can see all issues and attachments, including the Attachment Inbox. There is no
public registration or per-project isolation.

Run `pnpm auth:setup` to enable authentication. Open the private, one-use URL in
`data/owner-setup.txt` within 24 hours and choose your email and a password of
15–128 characters. Keep the link private: whoever redeems it first becomes the
owner. Rerunning setup before an owner exists invalidates the previous link;
afterward it refuses to replace the owner.

Under **Account**, the owner creates email-bound member invitation links, revokes
invitations, and disables or restores members. Invitations expire after 48 hours.
Share links manually; Sentinel does not send email. Tokens use URL fragments and
are removed from the address bar after loading. Keep the original link until you
finish setup in case you need to refresh the page.

Members can work on issues, comments, links, attachments and inbox captures. Only
the owner can change project settings, field definitions, capture sources, or
import/export backups. Disabling an account invalidates its sessions and recovery
links immediately. Everyone can change their password in **Account**, which also
signs out their other sessions.

For recovery, run `pnpm auth:recover account@example.com` on the server. The
one-use URL is saved privately to `data/account-recovery.txt` and expires after
one hour. This requires server filesystem access and cannot re-enable accounts.

## Security and hosting

Passwords use salted scrypt (N=131072, r=8, p=1). Random 256-bit session and invite
tokens are stored as SHA-256 hashes. Sessions last 12 hours and use HttpOnly,
SameSite=Strict cookies, with Secure and the __Host- prefix on HTTPS origins.
Mutations require an exact matching Origin. Authentication attempts are limited
to 20 per 15 minutes per account and direct client address, with at most two
simultaneous password derivations. Forwarded IP headers are not trusted, so users
behind a proxy share its address limit. Configure proxy-aware rate limiting before
larger deployments.

For hosting set `SENTINEL_PUBLIC_ORIGIN=https://your-domain.example` and
`SENTINEL_DATA_DIR=/persistent/data`. A public origin forces login even before
an owner exists. Account tables live in the SQLite database; full database
backups include password hashes and sessions and must remain private. JSON
workspace exports exclude authentication data.

The local server remains on 127.0.0.1 and denies static access to data folders and
database files. **This change does not provide a public production server.**
Hosting still requires a production API adapter, HTTPS, persistent storage,
backups and deployment verification. Do not expose the Vite development server.

Render with a paid web service and persistent disk, or Railway with a persistent
volume, fit the current storage approach. Check volume capacity for videos.
Use one application instance with SQLite and maintain independent backups.

The Mac Photos helper continues importing locally without a browser session.
Uploading to a hosted workspace requires a separate authenticated device-upload
integration; browser login does not add that capability.
