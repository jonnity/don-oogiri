import { useState } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";
import { AudienceLink } from "./AudienceLink.js";
import { createMatch } from "./api.js";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { MarkerBar } from "./MarkerBar.js";
import { MatchControls } from "./MatchControls.js";
import { OpsPanel } from "./OpsPanel.js";
import { openProjectionWindow } from "./projectionWindow.js";
import {
  clearStoredMatchId,
  resolveAudienceBaseUrl,
  resolveMatchId,
  resolveServerUrl,
  setAudienceBaseUrl,
  setServerUrl,
  setStoredMatchId,
} from "./settings.js";
import { SetupForm } from "./SetupForm.js";
import { useMatchSocket } from "./useMatchSocket.js";

export function App() {
  const [serverUrl, setServerUrlState] = useState<string | null>(() => resolveServerUrl());
  const [audienceBaseUrl, setAudienceBaseUrlState] = useState<string | null>(() =>
    resolveAudienceBaseUrl(),
  );
  const [showSettings, setShowSettings] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(() => resolveMatchId());
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** trueの間は既存セッション(matchId)を保持したまま次の試合のSetupFormを表示する。 */
  const [isSettingUpNewMatch, setIsSettingUpNewMatch] = useState(false);
  const { state, clockOffset, status, lastError, sendEvent } = useMatchSocket(
    serverUrl ?? "",
    serverUrl ? matchId : null,
  );
  const showSetupForm = !matchId || isSettingUpNewMatch;

  function handleSaveSettings(newServerUrl: string, newAudienceBaseUrl: string) {
    setServerUrl(newServerUrl);
    setAudienceBaseUrl(newAudienceBaseUrl);
    setServerUrlState(newServerUrl);
    setAudienceBaseUrlState(newAudienceBaseUrl);
    setShowSettings(false);
  }

  async function handleCreate(req: CreateMatchRequest) {
    if (!serverUrl || !audienceBaseUrl) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await createMatch(serverUrl, req);
      setMatchId(res.matchId);
      setStoredMatchId(res.matchId);
      // 試合作成のたびに毎回手動で開かせるのは運用上の手間なので、既定で自動的に開く
      // （プロジェクター出力ウィンドウを閉じてしまった場合の再オープン用に手動ボタンも残す）。
      void openProjectionWindow({ matchId: res.matchId, serverUrl, audienceBaseUrl });
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

  /**
   * 既存セッション(matchId/DOルーム/QRコード)は維持したまま、次の試合のチーム・お題を
   * 入力し直すSetupFormを開く。1イベント内で複数試合をこなす運用で、毎回QRを読ませ直す
   * 手間を避けるための導線（新しいDOは作らない）。
   */
  function handleStartNewMatch() {
    setIsSettingUpNewMatch(true);
  }

  /** SetupForm送信時。matchId既存時（次の試合）はNEW_MATCHイベントを既存セッションへ送るだけで、新規作成APIは呼ばない。 */
  function handleSetupSubmit(req: CreateMatchRequest) {
    if (matchId) {
      sendEvent({ type: "NEW_MATCH", ...req });
      setIsSettingUpNewMatch(false);
      return;
    }
    void handleCreate(req);
  }

  /**
   * セッション(matchId/QRコード)そのものを破棄し、次に作る試合から新しいQRコードに切り替える。
   * 通常の「次の試合」はhandleStartNewMatchで同一セッションのまま進めるため、この操作は
   * イベントを跨ぐ・QRを配り直す等、意図的にセッションを切り替えたい場合だけに使う。
   */
  function handleAbandonSession() {
    if (
      !confirm(
        "現在のセッション(QRコード)を破棄して、新しいセッションを開始しますか？\n観客には新しいQRコードを読み直してもらう必要があります。",
      )
    ) {
      return;
    }
    clearStoredMatchId();
    setMatchId(null);
    setIsSettingUpNewMatch(false);
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

      {showSetupForm && (
        <SetupForm
          onCreate={handleSetupSubmit}
          isSubmitting={isCreating}
          onCancel={matchId ? () => setIsSettingUpNewMatch(false) : undefined}
        />
      )}
      {createError && <p className="error">{createError}</p>}

      <p className="connection-status">
        接続先: {serverUrl}{" "}
        <button onClick={() => setShowSettings(true)}>接続設定を変更</button>
      </p>

      {matchId && (
        <>
          <p className="connection-status">
            接続: {status} / matchId: {matchId}{" "}
            {!showSetupForm && (
              <button onClick={handleStartNewMatch}>次の試合を作る</button>
            )}{" "}
            <button onClick={handleOpenProjection}>投影画面を開く</button>{" "}
            <button onClick={handleAbandonSession}>セッションを破棄して新規開始</button>
          </p>
          {lastError && <p className="error">サーバーエラー: {lastError}</p>}
          <AudienceLink matchId={matchId} audienceBaseUrl={audienceBaseUrl} />
          {!showSetupForm &&
            (state ? (
              <>
                <MarkerBar state={state} clockOffset={clockOffset} />
                <MatchControls state={state} onSend={sendEvent} />
                <OpsPanel state={state} onSend={sendEvent} />
              </>
            ) : (
              <p>状態を読み込み中...</p>
            ))}
        </>
      )}
    </main>
  );
}
