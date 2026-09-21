import { priorityLabel } from '../lib/priority';
import type { Issue } from '../lib/bugs';
import type { FieldDefinition } from '../lib/field-schema.mjs';
export function QuickField({
  issue,
  field,
  fields,
  busy,
  onChange,
}: {
  issue: Issue;
  field: 'status' | 'priority';
  fields: FieldDefinition[];
  busy?: boolean;
  onChange: (issue: Issue, field: 'status' | 'priority', value: string) => void;
}) {
  const options = fields.find((f) => f.key === field)?.options ?? [];
  return (
    <select
      className={'quick-field badge ' + issue[field].replaceAll(' ', '-')}
      aria-label={`${field} for ${issue.title}`}
      value={issue[field]}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(issue, field, e.target.value)}
    >
      {[...new Set([...options, issue[field]])].map((option) => (
        <option key={option} value={option}>
          {field === 'priority' ? priorityLabel(option) : option}
        </option>
      ))}
    </select>
  );
}
