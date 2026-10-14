# Collaboration

With accounts enabled, Reporter and Assignee use account email addresses. New reports default to the signed-in reporter. Only active accounts that have accepted an invitation can receive new assignments. Existing assignments to disabled accounts remain visible. Local workspaces without accounts keep their existing text fields.

**My issues** in the sidebar includes issues assigned to or reported by the signed-in account. Search, filters, sorting and pagination apply within that view.

Issue history and comments record the account that performed the action. This includes field edits, status changes, links, attachment changes, moving to Trash and restoration. Actor identity is taken from the authenticated session. Existing history without an actor is shown as “Earlier activity”; Sentinel does not guess who performed old changes.

Owners can use **Admin → People** to link an older name such as “Raf” or “Rafal” to an active account. After confirmation, all matching Reporter and Assignee values are updated, including in Trash. The mapping is recorded in issue history. Map each old spelling separately. Historical comments and changes are not relabeled.

Deleting an issue moves it to **Trash**. Restore brings back the same issue number, attachments, comments, history and relationships. Trashed issues are hidden from active lists, relationships and attachment access. Numbers stay reserved while an issue is in Trash. Nothing is automatically purged. Backups include trashed issues and their files; imported trashed issues remain in Trash with new IDs, consistent with existing backup import behavior.

Trash protects whole-issue deletion. Individual attachment and inbox capture deletion still use their existing deletion flows.

## Project issue IDs and CSV export

Each project has a stable prefix derived from its name: Ferment Tracker becomes `FT`. Matching prefixes are disambiguated (`FT2`, etc.). Bugs, ideas, tasks and feature requests each have their own increasing counter, such as `FT-BUG-1` and `FT-IDEA-1`. Existing issues receive numbers in creation order. Trash retains its numbers. Renaming a project preserves its prefix; moving an issue to another project or changing its type assigns the next number in the destination sequence. Internal links and attachment associations remain unchanged.

Open Projects, choose a project, then expand Export CSV. Choose all time, past day/week/month/year, or an inclusive custom date range in your local timezone. Choose date created or last updated, and optionally an issue type. The file includes all report fields, custom fields, comments, history and attachment names, with a UTF-8 signature for Excel. Media bytes and trashed issues are excluded. Spreadsheet formula-like text is prefixed with an apostrophe for safe opening. Use the workspace backup to transfer media or restore the complete workspace.
