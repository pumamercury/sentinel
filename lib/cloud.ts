import { createClient } from '@supabase/supabase-js';
export const cloudEnabled = import.meta.env.VITE_SENTINEL_CLOUD === 'true';
const projectUrl = import.meta.env.VITE_SUPABASE_URL || '';
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const client = cloudEnabled
  ? createClient(projectUrl, publicKey, {
      auth: {
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'sentinel-cloud-session',
      },
    })
  : null;
export async function cloudFetch(path: string, options: RequestInit = {}) {
  if (!client) throw Error('Cloud connection is not configured.');
  const {
    data: { session },
  } = await client.auth.getSession();
  const headers = new Headers(options.headers);
  headers.set('apikey', publicKey);
  if (session) headers.set('Authorization', 'Bearer ' + session.access_token);
  const response = await fetch(
    projectUrl + '/functions/v1/sentinel-api/' + path,
    { ...options, headers },
  );
  if (response.status === 401)
    window.dispatchEvent(new Event('sentinel-session-expired'));
  return response;
}
export async function cloudApi<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (path === 'backup' && method === 'GET') {
    const manifest = await cloudApi<{
      schemaVersion: number;
      exportedAt: string;
      bugs: ({ id: number } & Record<string, unknown>)[];
      fields: unknown;
      projects: unknown;
      links: unknown;
      files: {
        id: string;
        name: string;
        issueId: number | null;
        source: string;
        downloadUrl: string;
        createdAt: string;
        size: number;
      }[];
    }>('backup/manifest');
    const files: (Omit<(typeof manifest.files)[number], 'downloadUrl'> & {
      base64: string;
      downloadUrl?: undefined;
    })[] = [];
    for (const file of manifest.files) {
      const response = await fetch(file.downloadUrl);
      if (!response.ok)
        throw Error('Backup file download failed. Please retry.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== file.size)
        throw Error('Backup file verification failed.');
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      files.push({ ...file, downloadUrl: undefined, base64: btoa(binary) });
    }
    const { files: unused, ...metadata } = manifest;
    return {
      ...metadata,
      bugs: manifest.bugs.map((b) => ({
        ...b,
        attachments: files.filter((f) => f.issueId === b.id),
      })),
      inbox: files.filter((f) => f.source === 'inbox'),
    } as T;
  }
  if (path === 'import' && new Blob([JSON.stringify(body)]).size > 19_000_000)
    throw Error(
      'Web imports support backups up to 19 MB. Larger backups need the migration tool.',
    );

  const response = await cloudFetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw Error(data.error || 'Unable to complete request.');
  return data;
}
export async function cloudAuth<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (!client) throw Error('Cloud connection is not configured.');
  const value = body as
    | {
        email: string;
        password: string;
        token: string;
        currentPassword: string;
      }
    | undefined;
  if (path === 'login') {
    const { error } = await client.auth.signInWithPassword({
      email: value!.email,
      password: value!.password,
    });
    if (error) throw error;
    const session = await cloudApi<{ user: unknown }>('auth/session');
    if (!session.user) {
      await client.auth.signOut();
      throw Error('This account does not have workspace access.');
    }
    return session as T;
  }
  if (path === 'accept') {
    if (value!.password.length < 15 || value!.password.length > 128)
      throw Error('Use a password of 15–128 characters.');
    const { error } = await client.auth.verifyOtp({
      token_hash: value!.token,
      type: 'invite',
    });
    if (error) throw error;
    const session = await cloudApi<{ user: { email: string } | null }>(
      'auth/session',
    );
    if (
      !session.user ||
      session.user.email.toLowerCase() !== value!.email.trim().toLowerCase()
    ) {
      await client.auth.signOut();
      throw Error('Use the invited email address.');
    }
    const updated = await client.auth.updateUser({ password: value!.password });
    if (updated.error) throw updated.error;
    await cloudApi('auth/accepted', 'POST', {});
    return session as T;
  }
  if (path === 'logout') {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    return {} as T;
  }
  if (path === 'password') {
    if (value!.password.length < 15 || value!.password.length > 128)
      throw Error('Use a password of 15–128 characters.');
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user?.email) throw Error('Sign in required.');
    const verified = await client.auth.signInWithPassword({
      email: user.email,
      password: value!.currentPassword,
    });
    if (verified.error) throw verified.error;
    const updated = await client.auth.updateUser({ password: value!.password });
    if (updated.error) throw updated.error;
    const signedOut = await client.auth.signOut({ scope: 'others' });
    if (signedOut.error) throw signedOut.error;
    return {} as T;
  }
  return cloudApi<T>('auth/' + path, method, body);
}
async function optimizeImage(file: File): Promise<File> {
  // Browser PNG encoding is lossless; retain originals unless the result is smaller.
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40_000_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (blob && blob.size < file.size * 0.95)
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', {
        type: 'image/png',
      });
  } catch {
    /* Unsupported or animated formats are kept intact. */
  }
  return file;
}
export async function cloudUpload<T>(
  issueId: number,
  file: File,
  onProgress?: (value: number) => void,
): Promise<T> {
  if (!client) throw Error('Cloud connection is not configured.');
  if (file.size > 250_000_000)
    throw Error('Each attachment must be at most 250 MB before optimization.');
  // Avoid flattening animated WebP/APNG: optimize only conventional PNG/JPEG after header checks.
  const header = new Uint8Array(await file.slice(0, 1000000).arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(header);
  const optimized =
    !ascii.includes('acTL') && !ascii.includes('ANIM')
      ? await optimizeImage(file)
      : file;
  if (optimized.size > 50_000_000)
    throw Error('Each hosted attachment must be at most 50 MB.');
  const upload = await cloudApi<{ id: string; path: string; token: string }>(
    'uploads/prepare',
    'POST',
    { issueId, name: optimized.name, size: optimized.size },
  );
  onProgress?.(0);
  const { error } = await client.storage
    .from('sentinel-attachments')
    .uploadToSignedUrl(upload.path, upload.token, optimized, {
      contentType: optimized.type || 'application/octet-stream',
    });
  if (error) throw error;
  onProgress?.(100);
  return cloudApi<T>('uploads/complete', 'POST', { id: upload.id });
}
