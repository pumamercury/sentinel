#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export CLANG_MODULE_CACHE_PATH="${TMPDIR:-/tmp}/sentinel-clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="${TMPDIR:-/tmp}/sentinel-swift-cache"
swift build --disable-sandbox -c release --cache-path "${TMPDIR:-/tmp}/sentinel-spm-cache"
APP="$PWD/output/Sentinel.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/Sentinel "$APP/Contents/MacOS/Sentinel.next"
mv -f "$APP/Contents/MacOS/Sentinel.next" "$APP/Contents/MacOS/Sentinel"
cp Sources/Sentinel/Resources/SentinelRobot.svg "$APP/Contents/Resources/SentinelRobot.svg"
xcrun swift scripts/make-icon.swift "$PWD/output/Sentinel.iconset"
iconutil -c icns "$PWD/output/Sentinel.iconset" -o "$APP/Contents/Resources/SentinelRobot.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Sentinel</string>
<key>CFBundleDisplayName</key><string>Sentinel</string>
<key>CFBundleIdentifier</key><string>local.sentinel.macos</string>
<key>CFBundleExecutable</key><string>Sentinel</string>
<key>CFBundleIconFile</key><string>SentinelRobot</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
# Finder custom-icon metadata is not allowed inside a signed bundle.
# The app sets its Dock artwork explicitly at launch instead.
xattr -dr com.apple.FinderInfo "$APP" 2>/dev/null || true
xattr -dr com.apple.ResourceFork "$APP" 2>/dev/null || true
rm -f "$APP/"$'Icon\r'
codesign --force --sign - "$APP"
printf 'Built %s\n' "$APP"
