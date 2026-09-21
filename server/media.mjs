import { openSync, readSync, closeSync, createReadStream } from 'node:fs';
export function mediaInfo(bytes) {
  const hex = bytes.subarray(0, 12).toString('hex'),
    ascii = bytes.subarray(0, 16).toString('ascii');
  if (hex.startsWith('89504e470d0a1a0a'))
    return { kind: 'image', mime: 'image/png' };
  if (hex.startsWith('ffd8ff')) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a'))
    return { kind: 'image', mime: 'image/gif' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
    return { kind: 'image', mime: 'image/webp' };
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12);
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
    if (
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV'].includes(brand)
    )
      return { kind: 'video', mime: 'video/mp4' };
  }
  if (hex.startsWith('1a45dfa3') && bytes.toString('ascii').includes('webm'))
    return { kind: 'video', mime: 'video/webm' };
  return null;
}
export function readMediaHeader(path) {
  const handle = openSync(path, 'r');
  try {
    const bytes = Buffer.alloc(512);
    const count = readSync(handle, bytes, 0, 512, 0);
    return mediaInfo(bytes.subarray(0, count));
  } finally {
    closeSync(handle);
  }
}
export function sendMedia(req, res, attachment, path) {
  const bytes = path ? null : Buffer.from(attachment.bytes);
  const media = path ? readMediaHeader(path) : mediaInfo(bytes);
  if (!media) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'Preview is not available for this file type.' }),
    );
    return;
  }
  const size = attachment.storage_size ?? bytes.length;
  const headers = {
    'Content-Type': media.mime,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': 'inline',
  };
  let start = 0,
    end = size - 1,
    status = 200;
  if (req.headers.range) {
    const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    if (!match[1]) {
      start = Math.max(0, size - Number(match[2]));
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start
    ) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  if (path) {
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } else res.end(bytes.subarray(start, end + 1));
}
