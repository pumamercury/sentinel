import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { mediaInfo } from '../server/media.mjs';
const directory = resolve(process.argv[2] || '');
const tokenFile = join(directory, 'migration-token');
const mode = process.argv[3] || 'upload';
const publicKey = 'sb_publishable_r-moHkceNs-iMPgq8Wk9aQ_gJWwhKP7';
const base = 'https://ymipxchbwewwouajoutx.supabase.co';
if (mode === 'prepare') {
  if (!existsSync(tokenFile))
    writeFileSync(tokenFile, randomBytes(32).toString('hex'), {
      mode: 0o600,
      flag: 'wx',
    });
  console.log(
    JSON.stringify({
      hash: createHash('sha256')
        .update(readFileSync(tokenFile, 'utf8'))
        .digest('hex'),
      expires: Date.now() + 2 * 3600000,
    }),
  );
  process.exit(0);
}
const token = readFileSync(tokenFile, 'utf8');
async function api(path, body) {
  const response = await fetch(
    base + '/functions/v1/sentinel-api/migration/' + path,
    {
      method: 'POST',
      headers: {
        apikey: publicKey,
        'content-type': 'application/json',
        'x-sentinel-migration': token,
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw Error(path + ': ' + (data.error || JSON.stringify(data)));
  return data;
}
if (mode === 'test-accounts') {
  const result = await api('test-accounts', {});
  writeFileSync(join(directory, 'test-accounts.json'), JSON.stringify(result), {
    mode: 0o600,
  });
  console.log('Temporary access-test accounts saved privately.');
  process.exit(0);
}
if (mode === 'cleanup-tests') {
  await api('cleanup-tests', {});
  console.log('Temporary access-test accounts removed.');
  process.exit(0);
}
if (mode === 'finish') {
  const result = await api('finish', {});
  writeFileSync(
    join(directory, 'owner-access.json'),
    JSON.stringify(result.owners, null, 2),
    { mode: 0o600 },
  );
  writeFileSync(
    resolve('data/cloud-connection.json'),
    JSON.stringify(
      { url: base, publishableKey: publicKey, token: result.companionToken },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    'Migration completed. Owner setup link and Mac connection saved privately.',
  );
  process.exit(0);
}
const manifest = JSON.parse(
  readFileSync(join(directory, 'manifest.json'), 'utf8'),
);
for (const file of manifest.files) {
  const bytes = readFileSync(join(directory, 'files', file.id));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    throw Error('Local file integrity check failed.');
  file.previewType = mediaInfo(bytes)?.kind ?? null;
}
if (!existsSync(join(directory, 'initialized'))) {
  await api('initialize', { manifest });
  writeFileSync(join(directory, 'initialized'), '1');
}
let count = 0;
for (const file of manifest.files) {
  const bytes = readFileSync(join(directory, 'files', file.id));
  const marker = join(directory, 'files', file.id + '.uploaded');
  if (!existsSync(marker)) {
    const upload = await api('upload', { id: file.id });
    const response = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mediaInfo(bytes)?.mime || 'application/octet-stream',
      },
      body: bytes,
    });
    if (!response.ok)
      throw Error(
        'File upload failed: ' +
          response.status +
          ' ' +
          (await response.text()),
      );
    writeFileSync(marker, '1');
  }
  const fileUrl = await api('verify', { id: file.id });
  const download = await fetch(fileUrl.previewUrl);
  if (!download.ok) throw Error('Verification download failed.');
  const remote = Buffer.from(await download.arrayBuffer());
  if (
    remote.length !== file.size ||
    createHash('sha256').update(remote).digest('hex') !== file.sha256
  )
    throw Error('Remote integrity check failed.');
  console.log(`Verified file ${++count}/${manifest.files.length}`);
}
console.log(
  `Verified ${manifest.bugs.length} issues and ${count} files. Migration remains open for access tests.`,
);
