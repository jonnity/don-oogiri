import { useState, type FormEvent } from "react";
import { getMatchIdFromUrl } from "./matchIdFromUrl.js";
import { PhaseView } from "./PhaseView.js";
import { resolveServerUrl } from "./serverUrl.js";
import { useAudienceSocket } from "./useAudienceSocket.js";
import { getOrCreateVoterId } from "./voterId.js";

const SERVER_URL = resolveServerUrl();
const VOTER_ID = getOrCreateVoterId();

export function App() {
  const [matchId, setMatchId] = useState<string | null>(() => getMatchIdFromUrl());

  if (!matchId) {
    return <JoinForm onJoin={setMatchId} />;
  }

  return <MatchView matchId={matchId} />;
}

function JoinForm({ onJoin }: { onJoin: (matchId: string) => void }) {
  const [manualMatchId, setManualMatchId] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = manualMatchId.trim();
    if (trimmed) onJoin(trimmed);
  }

  return (
    <main className="app">
      <h1>ドン大喜利 観客投票</h1>
      <p>会場のQRコードから開くと自動で試合に参加します。</p>
      <form onSubmit={handleSubmit} className="join-form">
        <label>
          試合ID（QRが使えない場合の手入力用）
          <input value={manualMatchId} onChange={(e) => setManualMatchId(e.target.value)} />
        </label>
        <button type="submit">参加する</button>
      </form>
    </main>
  );
}

function MatchView({ matchId }: { matchId: string }) {
  const { state, status, lastVoteAck, sendVote } = useAudienceSocket(
    SERVER_URL,
    matchId,
    VOTER_ID,
  );

  return (
    <main className="app">
      <h1>ドン大喜利 観客投票</h1>
      {status !== "open" && <p className="connection-status">接続: {status}...</p>}
      {state ? (
        <PhaseView state={state} matchId={matchId} lastVoteAck={lastVoteAck} onVote={sendVote} />
      ) : (
        <p>試合の情報を読み込み中...</p>
      )}
    </main>
  );
}
