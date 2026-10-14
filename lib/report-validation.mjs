import { defaultFields } from './field-schema.mjs';
export const reportFields = [
  'title',
  'project',
  'description',
  'steps',
  'expected',
  'actual',
  'environment',
  'assignee',
  'labels',
  'version',
  'dueDate',
  'status',
  'priority',
  'severity',
];
export function validateReport(input, definitions = defaultFields) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid bug report.');
  const out = {};
  if (input.quickReport !== undefined && typeof input.quickReport !== 'boolean')
    throw Error('Invalid quick report setting.');
  if (input.quickReport === true) out.quickReport = true;
  out.issueType = input.issueType ?? 'Bug';
  if (typeof out.issueType !== 'string' || out.issueType.length > 500)
    throw Error('Invalid issue type.');
  out.issueType = out.issueType.trim();
  const typeOptions = definitions.find((f) => f.key === 'issueType')
    ?.options ?? ['Bug', 'Idea', 'Task', 'Feature request'];
  if (out.issueType && !typeOptions.includes(out.issueType))
    throw Error('Invalid issue type.');
  for (const key of reportFields) {
    const value = out.quickReport && input[key] === undefined ? '' : input[key];
    if (
      typeof value !== 'string' ||
      value.length >
        (['description', 'steps', 'expected', 'actual'].includes(key)
          ? 20000
          : 500)
    )
      throw Error(`Invalid ${key}.`);
    out[key] = value.trim();
  }
  for (const key of ['reproRate', 'component', 'reporter', 'fixVersion']) {
    out[key] = input[key] === undefined ? '' : input[key];
    if (typeof out[key] !== 'string' || out[key].length > 500)
      throw Error('Invalid ' + key);
    out[key] = out[key].trim();
  }
  if (out.status === 'Resolved' && !out.fixVersion)
    throw Error('Fix Version is required to resolve an issue.');
  for (const key of ['solution', 'acceptance']) {
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' || input[key].length > 20000)
    )
      throw Error('Invalid ' + key);
    out[key] = (input[key] ?? '').trim();
  }
  out.customFields = {};
  if (input.customFields !== undefined) {
    if (
      !input.customFields ||
      typeof input.customFields !== 'object' ||
      Array.isArray(input.customFields) ||
      Object.keys(input.customFields).length > 60
    )
      throw Error('Invalid custom fields.');
    for (const [key, value] of Object.entries(input.customFields)) {
      if (
        !/^custom_[a-zA-Z0-9_-]{1,80}$/.test(key) ||
        typeof value !== 'string' ||
        value.length > 20000
      )
        throw Error('Invalid custom field value.');
      out.customFields[key] = value.trim();
    }
  }
  if (!out.title || !out.project)
    throw Error('Title and project are required.');
  if (out.quickReport && (!out.status || !out.priority))
    throw Error('Status and priority are required.');
  for (const key of ['status', 'priority', 'severity']) {
    const options = definitions.find((f) => f.key === key)?.options ?? [];
    if (out[key] && !options.includes(out[key]))
      throw Error('Invalid ' + key + '.');
  }
  if (out.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(out.dueDate))
    throw Error('Invalid due date.');
  return out;
}
