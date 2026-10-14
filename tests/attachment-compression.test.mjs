import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApi } from '../server/api.mjs';
import {
  compressAttachment,
  compressBytes,
} from '../server/attachment-compression.mjs';
async function screenshot() {
  // Tiny high-contrast glyph-like marks exercise screenshot readability without system fonts.
  const pixels = Buffer.alloc(1000 * 600 * 3, 255);
  for (let y = 20; y < 80; y++)
    for (let x = 20; x < 900; x++) {
      if ((x % 7 < 2 || y % 9 < 2) && x % 11 < 8)
        pixels.fill(20, (y * 1000 + x) * 3, (y * 1000 + x) * 3 + 3);
    }
  return sharp(pixels, { raw: { width: 1000, height: 600, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}
test('screenshots retain decoded pixels, and invalid/unsupported files remain intact', async () => {
  const original = await screenshot();
  const compressed = await compressBytes(original, 'error.png');
  assert.equal(compressed.name, 'error.webp');
  assert.ok(compressed.bytes.length < original.length * 0.5);
  assert.deepEqual(
    await sharp(compressed.bytes).raw().toBuffer(),
    await sharp(original).raw().toBuffer(),
  );
  for (const bytes of [
    Buffer.alloc(3000),
    Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(3000)]),
  ]) {
    assert.deepEqual(await compressBytes(bytes, 'file.png'), {
      bytes,
      name: 'file.png',
    });
  }
});
test('video compression preserves frame count and resolution and leaves source intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-video-test-'));
  try {
    const source = join(dir, 'recording.mp4');
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=10',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-crf',
      '0',
      source,
    ]);
    const original = readFileSync(source);
    const result = await compressAttachment(source, 'recording.mp4');
    assert.ok(result);
    assert.ok(result.size < original.length);
    assert.deepEqual(readFileSync(source), original);
    const frames = execFileSync(ffmpeg, [
      '-v',
      'error',
      '-i',
      result.path,
      '-f',
      'framemd5',
      '-',
    ]).toString();
    assert.match(frames, /dimensions 0: 640x360/);
    assert.equal(
      frames.split('\n').filter((line) => line.startsWith('0,')).length,
      20,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('raw, JSON and inbox attachment paths compress and serve files; failed inbox assignment retains originals', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-compression-api-'));
  const source = join(dir, 'source');
  mkdirSync(source);
  const data = join(dir, 'data');
  mkdirSync(data);
  const api = createApi(join(data, 'test.sqlite'), {
    capture: { intervalMs: 3600000, stableMs: 0, available: async () => true },
  });
  const server = createServer((req, res) =>
    api.handler(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = (path) => `http://127.0.0.1:${server.address().port}/api/${path}`;
  const json = async (path, method = 'GET', body) => {
    const response = await fetch(url(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  try {
    const bug = await json('bugs', 'POST', {
      title: 'Compression',
      project: 'Test',
      issueType: 'Bug',
      status: 'Open',
      priority: 'Medium',
      quickReport: true,
    });
    const bytes = await screenshot();
    const route = `bugs/${bug.id}/attachments`;
    const raw = await fetch(url(route), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': 'screenshot.png',
      },
      body: bytes,
    });
    assert.equal(raw.status, 201);
    const first = await raw.json();
    const second = await json(route, 'POST', {
      name: 'screenshot.png',
      base64: bytes.toString('base64'),
    });
    await json('inbox/settings', 'PUT', {
      folder: source,
      enabled: true,
      extensions: ['.png'],
      nameContains: '',
    });
    writeFileSync(join(source, 'capture.png'), bytes);
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    const capture = api.inbox.status().files[0];
    assert.ok(capture);
    const before = readdirSync(join(data, 'attachments')).sort();
    const failed = await fetch(url('inbox/assign'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [capture.id], issueId: 99999 }),
    });
    assert.equal(failed.status, 400);
    assert.deepEqual(readdirSync(join(data, 'attachments')).sort(), before);
    assert.deepEqual(
      readFileSync(join(data, 'attachments', capture.id)),
      bytes,
    );
    await json('inbox/assign', 'POST', { ids: [capture.id], issueId: bug.id });
    assert.deepEqual(readFileSync(join(source, 'capture.png')), bytes);
    const files = await json(route);
    assert.equal(files.length, 3);
    for (const file of files) {
      assert.match(file.name, /\.webp$/);
      assert.ok(file.size < bytes.length);
      const response = await fetch(url(`${route}/${file.id}?preview=1`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/webp');
      assert.deepEqual(
        await sharp(Buffer.from(await response.arrayBuffer()))
          .raw()
          .toBuffer(),
        await sharp(bytes).raw().toBuffer(),
      );
    }
    assert.ok(first.id && second.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
