import { useState } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";
import { AudienceLink } from "./AudienceLink.js";
import { createMatch } from "./api.js";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { MarkerBar } from "./MarkerBar.js";
import { MatchControls } from "./MatchControls.js";
import { openProjectionWindow } from "./projectionWindow.js";
import {
  resolveAudienceBaseUrl,
  resolveServerUrl,
  setAudienceBaseUrl,
  setServerUrl,
} from "./settings.js";
import { SetupForm } from "./SetupForm.js";
import { useMatchSocket } from "./useMatchSocket.js";

export function App() {
  const [serverUrl, setServerUrlState] = useState<string | null>(() => resolveServerUrl());
  const [audienceBaseUrl, setAudienceBaseUrlState] = useState<string | null>(() =>
    resolveAudienceBaseUrl(),
  );
  const [showSettings, setShowSettings] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { state, clockOffset, status, lastError, sendEvent } = useMatchSocket(
    serverUrl ?? "",
    serverUrl ? matchId : null,
  );

  function handleSaveSettings(newServerUrl: string, newAudienceBaseUrl: string) {
    setServerUrl(newServerUrl);
    setAudienceBaseUrl(newAudienceBaseUrl);
    setServerUrlState(newServerUrl);
    setAudienceBaseUrlState(newAudienceBaseUrl);
    setShowSettings(false);
  }

  async function handleCreate(req: CreateMatchRequest) {
    if (!serverUrl) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await createMatch(serverUrl, req);
      setMatchId(res.matchId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsCreating(false);
    }
  }

  function handleOpenProjection() {
    if (!serverUrl || !audienceBaseUrl || !matchId) return;
    void openProjectionWindow({ matchId, serverUrl, audienceBaseUrl });
  }

  if (!serverUrl || !audienceBaseUrl || showSettings) {
    return (
      <main className="app">
        <h1>ドン大喜利 MC操作卓</h1>
        <ConnectionSettings
          initialServerUrl={serverUrl ?? ""}
          initialAudienceBaseUrl={audienceBaseUrl ?? ""}
          onSave={handleSaveSettings}
          onCancel={serverUrl && audienceBaseUrl ? () => setShowSettings(false) : undefined}
        />
      </main>
    );
  }

  return (
    <main className="app">
      <h1>ドン大喜利 MC操作卓</h1>

      {!matchId && <SetupForm onCreate={handleCreate} isSubmitting={isCreating} />}
      {createError && <p className="error">{createError}</p>}

      <p className="connection-status">
        接続先: {serverUrl}{" "}
        <button onClick={() => setShowSettings(true)}>接続設定を変更</button>
      </p>

      {matchId && (
        <>
          <p className="connection-status">
            接続: {status} / matchId: {matchId}{" "}
            <button onClick={() => setMatchId(null)}>新しい試合を作る</button>{" "}
            <button onClick={handleOpenProjection}>投影画面を開く</button>
          </p>
          {lastError && <p className="error">サーバーエラー: {lastError}</p>}
          <AudienceLink matchId={matchId} audienceBaseUrl={audienceBaseUrl} />
          {state ? (
            <>
              <MarkerBar state={state} clockOffset={clockOffset} />
              <MatchControls state={state} onSend={sendEvent} />
            </>
          ) : (
            <p>状態を読み込み中...</p>
          )}
        </>
      )}
    </main>
  );
}
