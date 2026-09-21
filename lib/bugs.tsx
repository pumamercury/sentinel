import { priorityLabel } from './priority';
export const statuses = [
  'Open',
  'In progress',
  'In review',
  'Resolved',
  'Closed',
];
export const priorities = ['Low', 'Medium', 'High', 'Critical'];
export type Report = {
  issueType: string;
  reproRate: string;
  component: string;
  customFields: Record<string, string>;
  title: string;
  project: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  solution: string;
  acceptance: string;
  environment: string;
  fixVersion: string;
  reporter: string;
  assignee: string;
  labels: string;
  version: string;
  dueDate: string;
  status: string;
  priority: string;
  severity: string;
};
export type Entry = { at: string; text: string };
export type Issue = Report & {
  id: number;
  createdAt: string;
  updatedAt: string;
  comments: Entry[];
  history: Entry[];
};
export const blank: Report = {
  issueType: 'Bug',
  reproRate: '',
  component: '',
  customFields: {},
  title: '',
  project: 'My project',
  description: '',
  steps: '',
  expected: '',
  actual: '',
  solution: '',
  acceptance: '',
  environment: '',
  fixVersion: '',
  reporter: '',
  assignee: '',
  labels: '',
  version: '',
  dueDate: '',
  status: 'Open',
  priority: 'Medium',
  severity: 'Major',
};
export type Project = {
  components?: string[];
  id: number;
  name: string;
  description: string;
  icon: string;
  image: string;
};
export type Attachment = {
  previewType: 'image' | 'video' | null;
  id: string;
  name: string;
  size: number;
  createdAt: string;
};
export function uploadAttachment(
  bugId: number,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Attachment> {
  if (file.size > 250_000_000)
    return Promise.reject(Error('Each attachment must be at most 250 MB.'));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/bugs/${bugId}/attachments`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    request.onerror = () => reject(Error('Upload interrupted. Please retry.'));
    request.onload = () => {
      try {
        const result = JSON.parse(request.responseText);
        if (request.status >= 200 && request.status < 300) resolve(result);
        else reject(Error(result.error || 'Upload failed.'));
      } catch {
        reject(Error('Upload failed. Please retry.'));
      }
    };
    request.send(file);
  });
}
export async function api<T = unknown>(
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch('/api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Error(data.error || 'Unable to complete this action.');
  return data;
}
export const badge = (text: string) => (
  <span className={'badge ' + text.replaceAll(' ', '-')}>
    {priorityLabel(text)}
  </span>
);
export const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
