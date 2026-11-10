import React, { useState } from "react";
import { AVATAR_PRESETS, AvatarSvg } from "../lib/avatars";
import { api } from "../lib/api";

export function AvatarPicker({
  selectedId,
  customUrl,
  onSelectPreset,
  onUploadedCustom,
  allowUpload = true,
}: {
  selectedId: string;
  customUrl?: string | null;
  onSelectPreset: (id: string) => void;
  onUploadedCustom?: (url: string) => void;
  allowUpload?: boolean;
}): React.ReactElement {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadedCustom) return;
    setErr(null);
    setUploading(true);
    try {
      const res = await api.uploadMedia(file, "avatar");
      onUploadedCustom(res.url);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-grid" role="radiogroup" aria-label="Choose an Elysium avatar">
        {AVATAR_PRESETS.map((preset) => {
          const active = !customUrl && selectedId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`avatar-preset-card ${active ? "is-active" : ""}`}
              onClick={() => onSelectPreset(preset.id)}
            >
              <AvatarSvg avatarId={preset.id} size={46} />
              <div className="avatar-preset-meta">
                <span className="avatar-preset-name">{preset.name}</span>
                <span className="avatar-preset-role">{preset.role}</span>
              </div>
            </button>
          );
        })}
      </div>

      {allowUpload && onUploadedCustom && (
        <div className="avatar-upload-bar">
          <label className="btn btn-secondary btn-sm">
            {uploading ? "Uploading…" : "Upload Custom Avatar (PNG/JPG/WebP ≤ 2MB)"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFile}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
          {customUrl && (
            <span className="badge badge-emerald">Custom image active</span>
          )}
          {err && <span className="form-error-inline">{err}</span>}
        </div>
      )}
    </div>
  );
}
