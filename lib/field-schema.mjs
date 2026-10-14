export const defaultFields = [
  ['title', 'Title', 'text', true],
  [
    'issueType',
    'Issue type',
    'select',
    true,
    ['Bug', 'Idea', 'Task', 'Feature request'],
  ],
  ['project', 'Project', 'text', true],
  [
    'status',
    'Status',
    'select',
    true,
    ['Open', 'In progress', 'In review', 'Resolved', 'Closed'],
  ],
  [
    'priority',
    'Priority',
    'select',
    true,
    ['Low', 'Medium', 'High', 'Critical'],
  ],
  ['severity', 'Severity', 'select', false, ['Minor', 'Major', 'Blocker']],
  ['reproRate', 'Repro rate', 'text'],
  ['component', 'Component', 'text'],
  ['reporter', 'Reporter', 'text'],
  ['assignee', 'Assignee', 'text'],
  ['dueDate', 'Due date', 'date'],
  ['description', 'Description', 'textarea'],
  ['steps', 'Steps to reproduce', 'textarea'],
  ['expected', 'Expected result', 'textarea'],
  ['actual', 'Actual result', 'textarea'],
  ['solution', 'Proposed solution', 'textarea'],
  ['acceptance', 'Acceptance criteria', 'textarea'],
  ['environment', 'Environment', 'select'],
  ['version', 'Affected version', 'text'],
  ['fixVersion', 'Fix version', 'text'],
  ['labels', 'Labels (comma separated)', 'text'],
].map(([key, label, type, required = false, options = []]) => ({
  key,
  label,
  type,
  required,
  options,
  enabled: true,
  builtin: true,
  issueTypes: ['steps', 'expected', 'actual', 'reproRate', 'severity'].includes(
    key,
  )
    ? ['Bug']
    : key === 'solution'
      ? ['Idea', 'Feature request']
      : key === 'acceptance'
        ? ['Task', 'Feature request']
        : [],
}));
export const lockedFields = ['title', 'project', 'status', 'priority'];
export const fieldApplies = (field, type = 'Bug') =>
  field.enabled &&
  (!field.issueTypes?.length || field.issueTypes.includes(type));
export const fieldLabel = (field, type) =>
  field.key === 'description' &&
  field.label === 'Description' &&
  type === 'Idea'
    ? 'Problem / opportunity'
    : field.label;
export function statusCategory(status, fields = defaultFields) {
  return (
    fields.find((f) => f.key === 'status')?.categories?.[status] ??
    (/^(resolved|closed|done|completed)$/i.test(status)
      ? 'completed'
      : /progress|review|testing/i.test(status)
        ? 'in-progress'
        : 'open')
  );
}

export function fieldTypeOptions(field) {
  if (!field.builtin) return ['text', 'textarea', 'select', 'number', 'date'];
  if (['reproRate', 'version', 'fixVersion', 'labels'].includes(field.key))
    return ['text', 'select'];
  return [defaultFields.find((f) => f.key === field.key)?.type ?? field.type];
}
