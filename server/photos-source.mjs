import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  unlinkSync,
  statSync,
  realpathSync,
} from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const appPath = fileURLToPath(
  new URL('../.macos/Sentinel Photos.app', import.meta.url),
);
const defaults = { enabled: false, scope: 'all', includeExisting: false };
const scopes = ['all', 'photos', 'videos', 'screenshots'];
function read(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
function atomic(path, data) {
  writeFileSync(path + '.tmp', JSON.stringify(data), { mode: 0o600 });
  renameSync(path + '.tmp', path);
}

export function photosSource(directory, options = {}) {
  const supported = (options.platform ?? process.platform) === 'darwin';
  const app = options.appPath ?? appPath;
  const launch =
    options.launch ??
    (() => execute('/usr/bin/open', ['-g', app, '--args', root]));
  const root = resolve(directory, 'photos');
  const configPath = join(root, 'config.json');
  const queuePath = join(root, 'queue');
  let error = '',
    stopped = false,
    launching = false,
    lastLaunch = 0;
  const settings = () => ({ ...defaults, ...read(configPath, {}) });
  function status() {
    const helper = read(join(root, 'status.json'), {});
    const stale = Date.now() - Date.parse(helper.updatedAt ?? '') > 45_000;
    return {
      supported,
      installed: supported && existsSync(app),
      settings: settings(),
      helper:
        stale && settings().enabled
          ? {
              ...helper,
              state: 'waiting',
              message:
                'Waiting for the Photos helper. Try reconnecting if this persists.',
            }
          : helper,
      error,
    };
  }
  async function heartbeat() {
    if (stopped || !supported || !settings().enabled) return;
    mkdirSync(queuePath, { recursive: true });
    atomic(join(root, 'lease.json'), { at: Date.now() / 1000 });
    const helper = read(join(root, 'status.json'), {});
    if (
      !launching &&
      Date.now() - lastLaunch > 30_000 &&
      (!helper.updatedAt ||
        Date.now() - Date.parse(helper.updatedAt) > 25_000 ||
        helper.state === 'paused')
    ) {
      launching = true;
      lastLaunch = Date.now();
      try {
        if (!existsSync(app))
          throw Error('Build the Apple Photos helper first: pnpm photos:build');
        await launch();
        error = '';
      } catch (e) {
        error = e.message;
      } finally {
        launching = false;
      }
    }
  }
  async function configure(input) {
    if (!supported) throw Error('Apple Photos is only available on macOS.');
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      typeof input.includeExisting !== 'boolean' ||
      !scopes.includes(input.scope)
    )
      throw Error('Choose a valid Photos scope and import settings.');
    if (input.enabled && !existsSync(app))
      throw Error('Build the Apple Photos helper first: pnpm photos:build');
    mkdirSync(queuePath, { recursive: true });
    atomic(configPath, {
      enabled: input.enabled,
      scope: input.scope,
      includeExisting: input.includeExisting,
    });
    lastLaunch = 0;
    await heartbeat();
    return status();
  }
  async function drain(ingest) {
    if (stopped || !supported || !settings().enabled || !existsSync(queuePath))
      return;
    const folder = realpathSync(queuePath);
    for (const manifest of readdirSync(folder).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    )) {
      if (stopped || !settings().enabled) break;
      const metadata = read(join(folder, manifest), null);
      if (
        !metadata ||
        typeof metadata.name !== 'string' ||
        !metadata.name ||
        typeof metadata.assetId !== 'string' ||
        !Number.isFinite(Date.parse(metadata.modified))
      ) {
        error = 'An invalid Photos export was left in the queue.';
        continue;
      }
      const file = join(folder, manifest.replace(/\.json$/, '.media'));
      if (!existsSync(file)) {
        error = 'A Photos export is missing its media file.';
        continue;
      }
      try {
        if (
          await ingest(
            {
              folder,
              name: basename(metadata.name),
              sourcePath: 'photos:' + metadata.assetId,
              sourceModified: metadata.modified,
            },
            file,
            statSync(file),
          )
        ) {
          // The inbox/hash transaction must commit before acknowledging the export.
          // Removing the manifest first makes a crash leave only a harmless orphan.
          unlinkSync(join(folder, manifest));
          unlinkSync(file);
          error = '';
        }
      } catch (e) {
        error = e.message;
      }
    }
  }
  const timer = setInterval(
    () =>
      void heartbeat().catch((e) => {
        error = e.message;
      }),
    5000,
  );
  timer.unref();
  return {
    status,
    configure,
    drain,
    close() {
      stopped = true;
      clearInterval(timer);
      if (existsSync(root)) atomic(join(root, 'lease.json'), { at: 0 });
    },
  };
}
