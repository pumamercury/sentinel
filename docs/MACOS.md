# Move Sentinel to a Mac

Sentinel runs locally using React, Node.js and SQLite. No hosting account is required.
The code has been checked on Windows; execution on macOS still needs verification on your Mac.

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

## Transfer your issues, pictures, attachments, and inbox

Git contains application code only. The ignored `data` folder contains your workspace.

1. In Windows, pause Attachment Inbox monitoring and stop Sentinel with Ctrl+C.
2. Copy the **entire `data` folder**, including `bugbook.sqlite`, any SQLite sidecar files, and `attachments`, to a private external drive or other trusted transfer location.
3. Stop Sentinel on the Mac if it is running. Place that folder inside the cloned Sentinel directory, beside `package.json`. Do not overwrite a Mac workspace you want to keep; back it up first.
4. Start Sentinel. Verify your project names, issue count, and an attachment preview.
5. In Attachment Inbox settings, select a Mac folder and enable monitoring when ready. The Windows iCloud Photos path does not exist on the Mac.

Keep the Windows copy until you have verified the migration. Do not commit the database or private backup exports to Git. Browser preferences such as sorting and page size are local to each browser and are not transferred with the database.

The Mac Photos library is not a normal watched folder. Export captures into a dedicated folder such as `~/Pictures/Sentinel Captures` and enter its **full absolute path** in Inbox settings. Use locally downloaded files. The Windows cloud-placeholder detection is Windows-specific; Sentinel does not integrate directly with Apple Photos or sign into iCloud on macOS.

## Verify and update

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

For later updates, stop Sentinel, run `git pull` and `pnpm install --frozen-lockfile`, then restart. Your ignored `data` folder remains local.
