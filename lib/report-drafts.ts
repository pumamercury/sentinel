import type { Report } from './bugs';
import type { Capture } from '../components/attachment-inbox';

export type ReportDraft = {
  creationToken: string;
  form: Report;
  files: File[];
  captures: Capture[];
  updatedAt: string;
  issueId?: number;
  issueCreatedAt?: string;
  comment?: string;
};

// IndexedDB keeps the selected files with the text, without uploading a draft.
// Each account has its own record, even when people share a browser.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sentinel-report-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Draft storage is busy.'));
  });
}

// Serialize writes so a slow file save cannot recreate a submitted/discarded draft.
let pendingWrite: Promise<unknown> = Promise.resolve();
export function writeDraft(
  key: string,
  draft: ReportDraft | null,
): Promise<void> {
  const operation = pendingWrite
    .catch(() => {})
    .then(async () => {
      const db = await database();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('drafts', 'readwrite');
          const store = transaction.objectStore('drafts');
          if (draft) store.put(draft, key);
          else store.delete(key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    });
  pendingWrite = operation;
  return operation;
}

export async function readDraft(key: string): Promise<ReportDraft | null> {
  await pendingWrite.catch(() => {});
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

type Context = {
  projectId?: number;
  byProject: Record<string, { environment: string; version: string }>;
};
export function readReportContext(key: string): Context {
  try {
    const value = JSON.parse(
      localStorage.getItem('sentinel.reportContext.' + key) || '{}',
    );
    return { projectId: value.projectId, byProject: value.byProject ?? {} };
  } catch {
    return { byProject: {} };
  }
}
export function rememberReportContext(
  key: string,
  projectId: number | undefined,
  form: Report,
) {
  if (!projectId) return;
  try {
    const context = readReportContext(key);
    context.projectId = projectId;
    context.byProject[projectId] = {
      environment: form.environment,
      version: form.version,
    };
    localStorage.setItem(
      'sentinel.reportContext.' + key,
      JSON.stringify(context),
    );
  } catch {
    /* Remembering a preference must never block reporting. */
  }
}
