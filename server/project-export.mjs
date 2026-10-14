function cell(value) {
  let text =
    value == null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  // Keep spreadsheet applications from evaluating user-entered formulas.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function projectCsv(issues, fields, attachments) {
  const columns = [
    ['issueKey', 'Issue ID'],
    ['project', 'Project'],
    ['issueType', 'Issue type'],
    ['title', 'Title'],
    ['status', 'Status'],
    ['priority', 'Priority'],
    ['severity', 'Severity'],
    ['reporter', 'Reporter'],
    ['assignee', 'Assignee'],
    ['description', 'Description'],
    ['steps', 'Steps to reproduce'],
    ['expected', 'Expected result'],
    ['actual', 'Actual result'],
    ['solution', 'Proposed solution'],
    ['acceptance', 'Acceptance criteria'],
    ['environment', 'Environment'],
    ['component', 'Component'],
    ['reproRate', 'Reproduction rate'],
    ['version', 'Affected version'],
    ['fixVersion', 'Fix version'],
    ['labels', 'Labels'],
    ['dueDate', 'Due date'],
    ['createdAt', 'Created at (UTC)'],
    ['updatedAt', 'Updated at (UTC)'],
    ['comments', 'Comments (JSON)'],
    ['history', 'Activity (JSON)'],
  ];
  const custom = [
    ...new Set([
      ...fields.filter((f) => !f.builtin).map((f) => f.key),
      ...issues.flatMap((b) => Object.keys(b.customFields ?? {})),
    ]),
  ];
  const header = [
    ...columns.map(([, label]) => label),
    ...custom.map(
      (key) => `${fields.find((f) => f.key === key)?.label ?? key} [${key}]`,
    ),
    'Attachment names (JSON)',
  ];
  const rows = issues.map((bug) => [
    ...columns.map(([key]) => bug[key]),
    ...custom.map((key) => bug.customFields?.[key]),
    attachments(bug.id).map((file) => file.name),
  ]);
  return (
    '\uFEFF' +
    [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') +
    '\r\n'
  );
}
