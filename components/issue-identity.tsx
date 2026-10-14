import { Bug, Lightbulb, ListTodo, Sparkles, FileText } from 'lucide-react';
export function issueLabel(id: number, type = 'Bug', issueKey?: string) {
  if (issueKey) return issueKey;
  return `${({ Bug: 'BUG', Idea: 'IDEA', Task: 'TASK', 'Feature request': 'FEAT' } as Record<string, string>)[type] || 'ISSUE'}-${id}`;
}
export function IssueIdentity({
  id,
  type = 'Bug',
  issueKey,
}: {
  id: number;
  type?: string;
  issueKey?: string;
}) {
  const Icon = issueTypeIcon(type);
  return (
    <span className="issue-identity" title={type}>
      <Icon size={15} aria-hidden="true" />
      <span>{issueLabel(id, type, issueKey)}</span>
      <span className="sr-only"> · {type}</span>
    </span>
  );
}
export function issueTypeIcon(type: string) {
  return (
    (
      {
        Bug: Bug,
        Idea: Lightbulb,
        Task: ListTodo,
        'Feature request': Sparkles,
      } as Record<string, typeof Bug>
    )[type] || FileText
  );
}
export function IssueTypeBadge({ type }: { type: string }) {
  const Icon = issueTypeIcon(type);
  return (
    <span className="issue-identity">
      <Icon size={18} aria-hidden="true" />
      <span>{type}</span>
    </span>
  );
}
