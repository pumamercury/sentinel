import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { join, resolve } from 'node:path';
import { compressAttachment } from '../server/attachment-compression.mjs';
import { mediaInfo } from '../server/media.mjs';
const directory = resolve(process.env.SENTINEL_DATA_DIR || 'data');
const settings = JSON.parse(
  await readFile(join(directory, 'cloud-connection.json'), 'utf8'),
);
if (
  !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(settings.url) ||
  typeof settings.token !== 'string'
)
  throw Error('Invalid Mac connection.');
const client = createClient(settings.url, settings.publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
async function api(path, body) {
  const response = await fetch(
    settings.url + '/functions/v1/sentinel-api/' + path,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        apikey: settings.publishableKey,
        'x-sentinel-companion': settings.token,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180000),
    },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Cloud sync failed.');
  return data;
}
async function sync() {
  const status = await api('companion/status');
  const known = new Set(status.hashes);
  const db = new DatabaseSync(join(directory, 'bugbook.sqlite'), {
    readOnly: true,
  });
  const captures = db
    .prepare(
      'SELECT id,name,hash,storage_size,bytes FROM capture_inbox ORDER BY created_at',
    )
    .all();
  db.close();
  let uploaded = 0;
  const problems = [];
  for (const capture of captures) {
    if (stopping || known.has(capture.hash)) continue;
    let optimized;
    try {
      const path = join(directory, 'attachments', capture.id);
      if (capture.storage_size !== null)
        optimized = await compressAttachment(path, capture.name);
      const bytes = optimized
        ? await readFile(optimized.path)
        : capture.storage_size === null
          ? Buffer.from(capture.bytes)
          : await readFile(path);
      if (bytes.length > 50_000_000)
        throw Error(
          `A capture exceeds the hosted 50 MB file limit: ${capture.name}`,
        );
      const prepared = await api('uploads/prepare', {
        issueId: null,
        name: optimized?.name || capture.name,
        size: bytes.length,
        captureHash: capture.hash,
      });
      const { error } = await client.storage
        .from('sentinel-attachments')
        .uploadToSignedUrl(prepared.path, prepared.token, bytes, {
          contentType: mediaInfo(bytes)?.mime || 'application/octet-stream',
        });
      if (error) throw error;
      await api('uploads/complete', { id: prepared.id });
      known.add(capture.hash);
      uploaded++;
    } catch (error) {
      problems.push({ id: capture.id, error: error.message });
    } finally {
      if (optimized) await unlink(optimized.path).catch(() => {});
    }
  }
  await writeFile(
    join(directory, 'cloud-status.json'),
    JSON.stringify({
      lastSync: new Date().toISOString(),
      uploaded,
      error: problems.length
        ? `${problems.length} capture(s) could not be synced.`
        : '',
      problems,
    }),
  );
  if (uploaded)
    console.log(
      `Sentinel: sent ${uploaded} new capture(s) to the cloud inbox.`,
    );
}
do {
  try {
    await sync();
  } catch (error) {
    console.error('Sentinel cloud inbox:', error.message);
    await writeFile(
      join(directory, 'cloud-status.json'),
      JSON.stringify({
        lastAttempt: new Date().toISOString(),
        error: error.message,
      }),
    ).catch(() => {});
  }
  if (process.argv.includes('--once') || stopping) break;
  await new Promise((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
      resolve();
    };
    const timer = setTimeout(stop, 30000);
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
} while (!stopping);
