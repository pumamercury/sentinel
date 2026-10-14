import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, unlink, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { readMediaHeader } from './media.mjs';
const run = promisify(execFile);
let queue = Promise.resolve();
// Serialize expensive conversions; never modify the input or accept a larger result.
export function compressAttachment(path, name) {
  const job = queue.then(() => compress(path, name));
  queue = job.catch(() => {});
  return job;
}
async function compress(path, name) {
  let output;
  try {
    const media = readMediaHeader(path);
    const original = (await stat(path)).size;
    if (!media || original < 1024) return null;
    const extension = media.kind === 'image' ? '.webp' : '.mp4';
    output = `${path}.${randomUUID()}${extension}`;
    if (media.kind === 'image') {
      const input = sharp(path, { limitInputPixels: 40_000_000 });
      const meta = await input.metadata();
      if ((meta.pages ?? 1) > 1 || meta.format === 'gif') return null;
      await input
        .rotate()
        .webp({ lossless: true, effort: 4 })
        .timeout({ seconds: 60 })
        .toFile(output);
    } else {
      // Skip HDR, alpha and multiple streams rather than lose meaningful evidence.
      const probe = await run(ffmpeg, ['-hide_banner', '-i', path], {
        timeout: 15000,
        maxBuffer: 1000000,
      }).catch((e) => e);
      const info = String(probe.stderr ?? '');
      if (
        (info.match(/Video:/g) ?? []).length !== 1 ||
        (info.match(/Audio:/g) ?? []).length > 1 ||
        /bt2020|smpte2084|arib-std-b67|yuva|Subtitle:|Data:/.test(info)
      )
        return null;
      await run(
        ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-i',
          path,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c:v',
          'libx264',
          '-crf',
          '18',
          '-preset',
          'fast',
          '-threads',
          '2',
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          '-y',
          output,
        ],
        { timeout: 180000, maxBuffer: 1000000 },
      );
    }
    const size = (await stat(output)).size;
    if (!size || size >= original * 0.95) return null;
    const result = {
      path: output,
      name:
        name.slice(0, name.length - extname(name).length).slice(0, 245) +
        extension,
      size,
    };
    output = null;
    return result;
  } catch {
    return null;
  } finally {
    if (output) await unlink(output).catch(() => {});
  }
}
export async function compressBytes(bytes, name) {
  const path = join(tmpdir(), `sentinel-compress-${randomUUID()}`);
  let result;
  try {
    await writeFile(path, bytes, { flag: 'wx' });
    result = await compressAttachment(path, name);
    return result
      ? { name: result.name, bytes: await readFile(result.path) }
      : { name, bytes };
  } finally {
    await unlink(path).catch(() => {});
    if (result) await unlink(result.path).catch(() => {});
  }
}
