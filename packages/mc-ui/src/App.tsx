import { useState } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";
import { AudienceLink } from "./AudienceLink.js";
import { createMatch } from "./api.js";
import { MarkerBar } from "./MarkerBar.js";
import { MatchControls } from "./MatchControls.js";
import { resolveServerUrl } from "./serverUrl.js";
import { SetupForm } from "./SetupForm.js";
import { useMatchSocket } from "./useMatchSocket.js";

const SERVER_URL = resolveServerUrl();

export function App() {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { state, clockOffset, status, lastError, sendEvent } = useMatchSocket(
    SERVER_URL,
    matchId,
  );

  async function handleCreate(req: CreateMatchRequest) {
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await createMatch(SERVER_URL, req);
      setMatchId(res.matchId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="app">
      <h1>ドン大喜利 MC操作卓（Phase 1 デバッグ用UI）</h1>

      {!matchId && <SetupForm onCreate={handleCreate} isSubmitting={isCreating} />}
      {createError && <p className="error">{createError}</p>}

      {matchId && (
        <>
          <p className="connection-status">
            接続: {status} / matchId: {matchId}{" "}
            <button onClick={() => setMatchId(null)}>新しい試合を作る</button>
          </p>
          {lastError && <p className="error">サーバーエラー: {lastError}</p>}
          <AudienceLink matchId={matchId} />
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
