import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

if (process.platform !== 'darwin')
  throw Error('The Photos helper requires macOS.');
const root = fileURLToPath(new URL('../', import.meta.url));
const contents = join(root, '.macos', 'Sentinel Photos.app', 'Contents');
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(join(root, '.macos', 'module-cache'), { recursive: true });
await writeFile(
  join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.sentinel.photos</string>
<key>CFBundleName</key><string>Sentinel Photos</string>
<key>CFBundleExecutable</key><string>SentinelPhotos</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSPhotoLibraryUsageDescription</key><string>Sentinel copies the photos and videos you choose into your local attachment inbox. It never changes or deletes your Photos originals.</string>
</dict></plist>`,
);
execFileSync(
  'xcrun',
  [
    'swiftc',
    '-swift-version',
    '5',
    '-O',
    '-module-cache-path',
    join(root, '.macos/module-cache'),
    join(root, 'native/photos/main.swift'),
    '-o',
    join(contents, 'MacOS/SentinelPhotos'),
    '-framework',
    'Photos',
    '-framework',
    'AppKit',
  ],
  { stdio: 'inherit' },
);
execFileSync('codesign', ['--force', '--sign', '-', join(contents, '..')], {
  stdio: 'inherit',
});
console.log('Built Sentinel Photos.app');
