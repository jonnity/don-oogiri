import { useEffect, useState } from "react";
import type { MatchState, TeamId } from "@don-oogiri/engine";
import { getLastVotedTeam, setLastVotedTeam } from "./voterId.js";
import type { VoteAck } from "./useAudienceSocket.js";

interface PhaseViewProps {
  state: MatchState;
  matchId: string;
  lastVoteAck: VoteAck | null;
  onVote: (team: TeamId) => void;
}

/**
 * 観客はゲーム内部の細かいフェーズ(INITIAL_WRITING/TIE_WRITING等)を知る必要がないので、
 * 「投票中か、そうでないか」の2値まで単純化する。投票中は投票UI自体が状態を示すので
 * 追加の文言は出さない。
 */
export function PhaseView({ state, matchId, lastVoteAck, onVote }: PhaseViewProps) {
  if (state.phase === "finished") {
    return (
      <div className="phase-view">
        <p className="winner-banner">
          🏆 {state.winner ? teamLabel(state, state.winner) : "-"} の勝ち！
        </p>
      </div>
    );
  }

  if (state.phase === "voting") {
    return (
      <div className="phase-view">
        <VotingSection state={state} matchId={matchId} lastVoteAck={lastVoteAck} onVote={onVote} />
      </div>
    );
  }

  return (
    <div className="phase-view">
      <p className="phase-label">投票開始をお待ちください</p>
      <p className="match-context">
        🔴 {state.teams.red.name} vs 🔵 {state.teams.blue.name}
      </p>
    </div>
  );
}

/**
 * 「選択 → 決定」の2段階にすることで、一発で確定してしまう不便さを解消する。
 * 決定済みでも「投票を変更する」から再度選び直せる（サーバ側は同一ラウンド内の再選択を許容する）。
 */
function VotingSection({ state, matchId, lastVoteAck, onVote }: PhaseViewProps) {
  const [confirmedTeam, setConfirmedTeam] = useState<TeamId | null>(() =>
    getLastVotedTeam(matchId, state.votingRoundId),
  );
  const [selectedTeam, setSelectedTeam] = useState<TeamId | null>(confirmedTeam);
  const [isChoosing, setIsChoosing] = useState(confirmedTeam === null);

  // 新しいラウンドが始まったら選択状態をリセットする
  useEffect(() => {
    const stored = getLastVotedTeam(matchId, state.votingRoundId);
    setConfirmedTeam(stored);
    setSelectedTeam(stored);
    setIsChoosing(stored === null);
  }, [matchId, state.votingRoundId]);

  function handleConfirm() {
    if (!selectedTeam) return;
    onVote(selectedTeam);
    setLastVotedTeam(matchId, state.votingRoundId, selectedTeam);
    setConfirmedTeam(selectedTeam);
    setIsChoosing(false);
  }

  if (!isChoosing && confirmedTeam) {
    return (
      <div className="voting-section">
        <p className="voted-status">投票済み: {teamLabel(state, confirmedTeam)}</p>
        {lastVoteAck && !lastVoteAck.accepted && (
          <p className="error">投票が反映されていない可能性があります：{lastVoteAck.reason}</p>
        )}
        <button className="change-vote" onClick={() => setIsChoosing(true)}>
          投票を変更する
        </button>
      </div>
    );
  }

  return (
    <div className="voting-section">
      <div className="vote-buttons">
        <button
          className={`vote-buttons__red${selectedTeam === "red" ? " is-selected" : ""}`}
          onClick={() => setSelectedTeam("red")}
        >
          🔴
          <br />
          {state.teams.red.name}
        </button>
        <button
          className={`vote-buttons__blue${selectedTeam === "blue" ? " is-selected" : ""}`}
          onClick={() => setSelectedTeam("blue")}
        >
          🔵
          <br />
          {state.teams.blue.name}
        </button>
      </div>
      <button className="confirm-vote" disabled={!selectedTeam} onClick={handleConfirm}>
        {confirmedTeam ? "この内容に変更する" : "決定する"}
      </button>
    </div>
  );
}

function teamLabel(state: MatchState, team: TeamId): string {
  return `${team === "red" ? "🔴" : "🔵"} ${state.teams[team].name}`;
}
