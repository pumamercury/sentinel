# Quick reporting

New issue opens a short form: choose a project, enter a title, and optionally add a description and evidence. Use **Add more details** for reproduction steps, environment, build, classification, and other configured fields.

- The current project takes precedence over the last used project. Environment and affected version are remembered separately for each project on this browser.
- Draft text, selected files, and inbox selections save automatically in this browser's IndexedDB, separately for each signed-in account. They are not uploaded until submission and are not included in database backups. Clearing browser site data removes drafts.
- **Save for later** closes the form after saving. **Resume draft** restores the unfinished report. One active draft is kept per account on each browser. **Discard draft** leaves inbox captures in the inbox.
- Browser storage limits still apply. If local draft storage fails, the form shows an error and can still be submitted. Files are limited to 250 MB each and 20 per report.
- Quick reports can be enriched later without filling every configured required detail field. Title, project, status, and priority remain required. Resolving an issue still requires a fix version. Existing full reports retain their configured required-field rules.
- Report creation uses an account-scoped token to prevent duplicate issues when a response is lost. If a retry finds an already-created issue, the form keeps the latest draft for review and an explicit **Save changes**.

Admin groups field settings, previews quick and full forms, and offers presets that stage changes until **Save fields** is selected. Presets preserve labels, options, visibility, and custom fields.

The legacy custom “Fix version” field is consolidated only when there is one unambiguous matching text field. Empty built-in values are backfilled and the duplicate is hidden. Original custom values, including conflicting values, remain in the database and backups. Multiple ambiguous matches remain unchanged.
