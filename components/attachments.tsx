'use client';
import { cloudEnabled } from '../lib/cloud';
import { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  Download,
  X,
  Play,
  Maximize2,
  FileText,
} from 'lucide-react';
import { api, uploadAttachment, type Attachment } from '../lib/bugs';
function Thumbnail({ file, url }: { file: Attachment; url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !file.previewType)
    return (
      <div className="file-placeholder">
        <FileText size={36} />
        <span>{file.name.split('.').pop()?.toUpperCase() || 'FILE'}</span>
      </div>
    );
  return file.previewType === 'image' ? (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <video
      src={url + '#t=0.1'}
      preload="metadata"
      muted
      playsInline
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}
export function Attachments({
  bugId,
  onRefresh,
}: {
  bugId: number;
  onRefresh?: () => Promise<void>;
}) {
  const [progress, setProgress] = useState(''),
    [files, setFiles] = useState<Attachment[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Attachment | null>(null),
    [closing, setClosing] = useState(false),
    [previewError, setPreviewError] = useState(false);
  const viewer = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = (f: Attachment, preview = false) =>
    (preview
      ? (files.find((x) => x.id === f.id)?.previewUrl ?? f.previewUrl)
      : (files.find((x) => x.id === f.id)?.downloadUrl ?? f.downloadUrl)) ??
    `/api/bugs/${bugId}/attachments/${f.id}${preview ? '?preview=1' : ''}`;
  const load = async () =>
    setFiles(await api<Attachment[]>(`bugs/${bugId}/attachments`));
  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    if (cloudEnabled) {
      const timer = setInterval(
        () => {
          void load().catch((e) => setError(e.message));
        },
        10 * 60 * 1000,
      );
      return () => clearInterval(timer);
    }
  }, [bugId]);
  useEffect(() => {
    if (selected) viewer.current?.showModal();
    else viewer.current?.close();
  }, [selected]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  function open(file: Attachment, button: HTMLButtonElement) {
    const bounds = button.getBoundingClientRect();
    const dialog = viewer.current;
    dialog?.style.setProperty(
      '--preview-x',
      `${bounds.left + bounds.width / 2 - window.innerWidth / 2}px`,
    );
    dialog?.style.setProperty(
      '--preview-y',
      `${bounds.top + bounds.height / 2 - window.innerHeight / 2}px`,
    );
    dialog?.style.setProperty(
      '--preview-scale',
      String(
        Math.max(
          0.15,
          Math.min(0.6, bounds.width / Math.min(window.innerWidth - 32, 1100)),
        ),
      ),
    );
    setClosing(false);
    setPreviewError(false);
    setSelected(file);
  }
  function close() {
    if (closing) return;
    video.current?.pause();
    setClosing(true);
    closeTimer.current = setTimeout(
      () => {
        setSelected(null);
        setClosing(false);
        closeTimer.current = null;
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
    );
  }
  async function upload(chosen: File[]) {
    setBusy(true);
    setError('');
    try {
      for (const f of chosen) {
        await uploadAttachment(bugId, f, (p) =>
          setProgress(f.name + ' — ' + p + '%'),
        );
        await load();
      }
    } catch (e) {
      setError(
        (e as Error).message + ' Files already uploaded are listed below.',
      );
    } finally {
      setBusy(false);
      await onRefresh?.().catch((e) => setError(e.message));
    }
  }
  async function remove(file: Attachment) {
    if (!confirm('Delete attachment ' + file.name + '?')) return;
    setBusy(true);
    setError('');
    try {
      await api(`bugs/${bugId}/attachments/${file.id}`, 'DELETE');
      await load();
      await onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-panel">
      <h2>
        <Paperclip size={18} /> Attachments{' '}
        <span className="count">{files.length}</span>
      </h2>
      <p className="muted">
        Click a screenshot or video to expand it. Up to 20 files, 250 MB each.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">Loading attachments…</p>
      ) : (
        <ul className="attachment-grid">
          {files.map((f) => (
            <li key={f.id} className="attachment-card">
              {f.previewType ? (
                <button
                  className="attachment-thumbnail"
                  type="button"
                  aria-label={'Preview ' + f.name}
                  onClick={(e) => open(f, e.currentTarget)}
                >
                  <Thumbnail file={f} url={url(f, true)} />
                  <span className="preview-affordance">
                    {f.previewType === 'video' ? (
                      <Play size={23} />
                    ) : (
                      <Maximize2 size={20} />
                    )}
                  </span>
                  <span className="preview-hint">
                    {f.previewType === 'video' ? 'Play video' : 'Expand image'}
                  </span>
                </button>
              ) : (
                <div className="attachment-thumbnail">
                  <Thumbnail file={f} url={url(f, true)} />
                </div>
              )}
              <div className="attachment-caption">
                <span className="attachment-name" title={f.name}>
                  {f.name}
                </span>
                <small>
                  {f.size >= 1_000_000
                    ? (f.size / 1_000_000).toFixed(1) + ' MB'
                    : (f.size / 1000).toFixed(1) + ' KB'}
                  {f.unavailable
                    ? ' · File missing from storage'
                    : !f.previewType
                      ? ' · Download to open'
                      : ''}
                </small>
                <div className="attachment-controls">
                  {!f.unavailable && (
                    <a
                      className="button"
                      aria-label={'Download ' + f.name}
                      href={url(f)}
                      download={f.name}
                    >
                      <Download size={16} />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={'Delete ' + f.name}
                    onClick={() => remove(f)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <label className="upload-field">
        {busy ? 'Uploading & optimizing ' + progress : 'Add attachments'}
        <input
          type="file"
          multiple
          disabled={busy || loading}
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </label>
      <p className="muted">
        {cloudEnabled
          ? 'Screenshots are optimized at full resolution. Direct video uploads keep their original quality; the Mac companion compresses supported videos.'
          : 'Images and videos are automatically compressed when smaller. Screenshots keep their full resolution.'}
      </p>
      <dialog
        ref={viewer}
        aria-labelledby="attachment-viewer-title"
        className={'attachment-viewer ' + (closing ? 'is-closing' : '')}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              close();
          }
        }}
      >
        {selected && (
          <>
            <div className="viewer-toolbar">
              <h2 id="attachment-viewer-title">{selected.name}</h2>
              <a
                className="button"
                href={url(selected)}
                download={selected.name}
                aria-label="Download attachment"
              >
                <Download size={18} />
              </a>
              <button
                type="button"
                autoFocus
                onClick={close}
                aria-label="Close preview"
              >
                <X size={20} />
              </button>
            </div>
            <div className="viewer-stage">
              {previewError ? (
                <div className="preview-error" role="alert">
                  <FileText size={40} />
                  <h3>Preview unavailable</h3>
                  <p>
                    {selected.previewType === 'video'
                      ? 'Your browser cannot play this video format. Download it to use a compatible player.'
                      : 'Your browser cannot display this image. You can still download the original.'}
                  </p>
                  <a
                    className="button"
                    href={url(selected)}
                    download={selected.name}
                  >
                    Download original
                  </a>
                </div>
              ) : selected.previewType === 'video' ? (
                <video
                  key={selected.id}
                  ref={video}
                  src={url(selected, true)}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onError={() => setPreviewError(true)}
                />
              ) : (
                <img
                  src={url(selected, true)}
                  alt={selected.name}
                  onError={() => setPreviewError(true)}
                />
              )}
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
