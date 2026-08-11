import { useState } from "react";

interface ConnectionSettingsProps {
  initialServerUrl: string;
  initialAudienceBaseUrl: string;
  onSave: (serverUrl: string, audienceBaseUrl: string) => void;
  onCancel?: () => void;
}

/**
 * サーバURL・観客投票ページURLを手動設定するフォーム。
 * Tauri配下では`location`からの自動推測ができないため必須の入力経路になる。
 * 通常のブラウザ利用時は既定値が埋まった状態で開けるので、変更不要ならそのまま保存すればよい。
 */
export function ConnectionSettings({
  initialServerUrl,
  initialAudienceBaseUrl,
  onSave,
  onCancel,
}: ConnectionSettingsProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [audienceBaseUrl, setAudienceBaseUrl] = useState(initialAudienceBaseUrl);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(serverUrl.trim(), audienceBaseUrl.trim());
  }

  return (
    <form className="connection-settings" onSubmit={handleSubmit}>
      <h2>接続設定</h2>
      <p>
        ネイティブアプリ版ではホスト名からの自動推測ができないため、サーバと観客投票ページのURLを設定してください。
      </p>
      <label>
        サーバURL
        <input
          type="url"
          required
          placeholder="https://don-oogiri-server.example.workers.dev"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </label>
      <label>
        観客投票ページURL
        <input
          type="url"
          required
          placeholder="https://don-oogiri-audience.example.pages.dev"
          value={audienceBaseUrl}
          onChange={(e) => setAudienceBaseUrl(e.target.value)}
        />
      </label>
      <div className="connection-settings__actions">
        <button type="submit">保存</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        )}
      </div>
    </form>
  );
}
