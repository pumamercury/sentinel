'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Download, Maximize2, Play, X, FileText } from 'lucide-react';
import type { Attachment } from '../lib/bugs';

export function InboxPreview({ file }: { file: Attachment }) {
  const [selected, setSelected] = useState(false),
    [closing, setClosing] = useState(false),
    [failed, setFailed] = useState(false);
  const viewer = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = useId();
  const url = file.downloadUrl ?? `/api/inbox/${file.id}`;
  const previewUrl = file.previewUrl ?? `/api/inbox/${file.id}?preview=1`;
  useEffect(() => {
    if (selected) viewer.current?.showModal();
    else viewer.current?.close();
  }, [selected]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function show(button: HTMLButtonElement) {
    const r = button.getBoundingClientRect();
    viewer.current?.style.setProperty(
      '--preview-x',
      `${r.x + r.width / 2 - window.innerWidth / 2}px`,
    );
    viewer.current?.style.setProperty(
      '--preview-y',
      `${r.y + r.height / 2 - window.innerHeight / 2}px`,
    );
    viewer.current?.style.setProperty('--preview-scale', '0.2');
    setFailed(false);
    setClosing(false);
    setSelected(true);
  }
  function close() {
    if (closing) return;
    video.current?.pause();
    setClosing(true);
    timer.current = setTimeout(
      () => {
        setSelected(false);
        setClosing(false);
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
    );
  }
  return (
    <>
      <button
        type="button"
        className="attachment-thumbnail"
        aria-label={`Preview ${file.name}`}
        disabled={!file.previewType}
        onClick={(e) => show(e.currentTarget)}
      >
        {file.previewType === 'image' ? (
          <img src={previewUrl} loading="lazy" alt="" />
        ) : file.previewType === 'video' ? (
          <video
            src={previewUrl + '#t=0.1'}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
        ) : (
          <span className="file-placeholder">
            <FileText size={36} />
            <span>{file.name.split('.').pop()?.toUpperCase()}</span>
          </span>
        )}
        {file.previewType && (
          <span className="preview-affordance">
            {file.previewType === 'video' ? (
              <Play size={24} />
            ) : (
              <Maximize2 size={20} />
            )}
          </span>
        )}
      </button>
      <dialog
        ref={viewer}
        aria-labelledby={title}
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
              <h2 id={title}>{file.name}</h2>
              <a
                className="button"
                href={url}
                download={file.name}
                aria-label="Download original"
              >
                <Download size={18} />
              </a>
              <button
                type="button"
                onClick={close}
                autoFocus
                aria-label="Close preview"
              >
                <X size={20} />
              </button>
            </div>
            <div className="viewer-stage">
              {failed ? (
                <p className="preview-error">
                  This format cannot be displayed in your browser.{' '}
                  <a href={url} download={file.name}>
                    Download original
                  </a>
                </p>
              ) : file.previewType === 'video' ? (
                <video
                  ref={video}
                  src={previewUrl}
                  autoPlay
                  controls
                  playsInline
                  onError={() => setFailed(true)}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={file.name}
                  onError={() => setFailed(true)}
                />
              )}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
