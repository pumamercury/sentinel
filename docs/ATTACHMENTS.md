# Attachment compression

New attachments are optimized on the server, both for direct uploads and when attaching captures from the inbox. Existing issue attachments and backup restores are unchanged. Photos library items and source folder files are never modified.

- Still PNG, JPEG and WebP images are converted to lossless WebP at full resolution, with orientation applied. Screenshot text retains its pixels. Images above 40 million pixels and animated images are retained as supplied.
- Supported SDR videos are converted to MP4 (H.264 CRF 18, AAC 192 kbps). Resolution and frame rate are preserved; odd dimensions receive a one-pixel pad. HDR, alpha, multiple video/audio streams, subtitles and data streams are left unchanged.
- A conversion is used only when at least 5% smaller. Unsupported files, conversion failures and timeouts fall back to the original. Some already-compressed files will not shrink.
- Optimization is serialized to limit CPU use, with a 60-second image timeout and 3-minute video timeout. Upload completion includes optimization time. The existing 250 MB upload limit still applies to the incoming file.
- The stored filename, download type and attachment size reflect the optimized file. Inbox captures remain available if assignment fails.

Install dependencies with `pnpm install`; the approved `ffmpeg-static` install step downloads the video encoder. Sharp uses its platform-specific prebuilt package. No separate Homebrew installation is required.

Run `node --test tests/attachment-compression.test.mjs` for pixel equality, video frame/resolution, upload, preview and inbox rollback checks.
