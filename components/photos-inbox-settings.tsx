'use client';
import { useState } from 'react';
export type PhotosState = {
  supported: boolean;
  installed: boolean;
  settings: { enabled: boolean; scope: string; includeExisting: boolean };
  helper: {
    state?: string;
    message?: string;
    problem?: string;
    processed?: number;
  };
  error: string;
};
export function PhotosInboxSettings({
  data,
  busy,
  save,
}: {
  data: PhotosState;
  busy: boolean;
  save: (settings: PhotosState['settings']) => void;
}) {
  const [scope, setScope] = useState(data.settings.scope);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [includeExisting, setIncludeExisting] = useState(
    data.settings.includeExisting,
  );
  if (!data.supported) return null;
  return (
    <section
      className="detail-panel photos-connection"
      aria-label="Apple Photos integration"
    >
      <div className="photos-connection-header">
        <div>
          <h2>
            <span
              className={
                'capture-dot ' + (data.settings.enabled ? 'enabled' : '')
              }
            />
            Apple Photos
          </h2>
          <output>
            {data.settings.enabled
              ? data.helper.message || 'Starting Photos helper…'
              : 'Photos import paused.'}
          </output>
          <p className="muted">
            {data.settings.includeExisting
              ? 'Existing and new items'
              : 'New items only'}{' '}
            ·{' '}
            {{
              all: 'Photos and videos',
              photos: 'Photos',
              videos: 'Videos',
              screenshots: 'Screenshots',
            }[data.settings.scope] || 'Selected media'}
          </p>
        </div>
        <div className="actions">
          {data.settings.enabled && (
            <button
              disabled={busy}
              onClick={() => save({ ...data.settings, enabled: false })}
            >
              Pause
            </button>
          )}
          <button
            aria-expanded={!data.settings.enabled || settingsOpen}
            aria-controls="photos-connection-settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            {settingsOpen ? 'Hide settings' : 'Connection settings'}
          </button>
        </div>
      </div>
      {(data.error ||
        data.helper.problem ||
        data.helper.state === 'denied') && (
        <p role="alert" className="error">
          {data.error || data.helper.problem || data.helper.message}
        </p>
      )}
      {(!data.settings.enabled || settingsOpen) && (
        <div
          className="inbox-settings photos-connection-settings"
          id="photos-connection-settings"
        >
          <p className="muted">
            Collect images and videos from your Mac’s Photos library, including
            items synced from iCloud. Originals stay untouched. Runs while
            Sentinel is open.
          </p>
          <label>
            Collect from Photos
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All photos and videos</option>
              <option value="photos">Photos only</option>
              <option value="videos">Videos only</option>
              <option value="screenshots">Screenshots only</option>
            </select>
          </label>
          <label className="inbox-enable">
            <input
              type="checkbox"
              checked={includeExisting}
              onChange={(e) => setIncludeExisting(e.target.checked)}
            />{' '}
            Include existing library items
          </label>
          <p className="muted">
            {includeExisting
              ? 'Existing matching items will be copied as well as new ones. Large libraries can take time and use substantial disk space.'
              : 'The first connection skips existing library items and collects items added afterward.'}{' '}
            iCloud originals download as needed. Up to 250 MB per file;
            duplicates are skipped. HEIC and some videos may require downloading
            to view.
          </p>
          {!data.installed && (
            <p role="alert">
              The Photos helper needs to be built on this Mac before connecting.
            </p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !data.installed}
              onClick={() => {
                save({ enabled: true, scope, includeExisting });
                setSettingsOpen(false);
              }}
            >
              {data.settings.enabled
                ? 'Save and reconnect Photos'
                : 'Connect Apple Photos'}
            </button>
            {data.settings.enabled && (
              <button
                disabled={busy}
                onClick={() => save({ ...data.settings, enabled: false })}
              >
                Pause Photos import
              </button>
            )}
          </div>
          {data.settings.enabled && (
            <p className="muted">
              macOS will ask you to allow “Sentinel Photos” access to Photos.
              You can revoke access in System Settings → Privacy &amp; Security
              → Photos.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
