import { useEffect, useState } from "react";
import type { MatchState, TeamId } from "@don-oogiri/engine";
import { getLastVotedRound, setLastVotedRound } from "./voterId.js";
import type { VoteAck } from "./useAudienceSocket.js";

interface PhaseViewProps {
  state: MatchState;
  matchId: string;
  lastVoteAck: VoteAck | null;
  onVote: (team: TeamId) => void;
}

const PHASE_LABEL: Record<MatchState["phase"], string> = {
  setup: "まもなく開始します",
  initial_writing: "両チームが回答を書いています",
  voting: "投票してください！",
  challenge_writing: "回答者が執筆中です",
  finished: "試合終了",
};

export function PhaseView({ state, matchId, lastVoteAck, onVote }: PhaseViewProps) {
  const [hasVotedThisRound, setHasVotedThisRound] = useState(
    () => getLastVotedRound(matchId) === state.votingRoundId,
  );

  // 新しいラウンドが始まったら、この端末がまだ投票していないかlocalStorageで再判定する
  useEffect(() => {
    setHasVotedThisRound(getLastVotedRound(matchId) === state.votingRoundId);
  }, [matchId, state.votingRoundId]);

  function handleVote(team: TeamId) {
    onVote(team);
    setLastVotedRound(matchId, state.votingRoundId);
    setHasVotedThisRound(true);
  }

  if (state.phase === "finished") {
    return (
      <div className="phase-view">
        <p className="winner-banner">
          🏆 {state.winner ? teamLabel(state, state.winner) : "-"} の勝ち！
        </p>
      </div>
    );
  }

  if (state.phase === "voting" && !hasVotedThisRound) {
    return (
      <div className="phase-view">
        <p className="phase-label">{PHASE_LABEL[state.phase]}</p>
        <div className="vote-buttons">
          <button className="vote-buttons__red" onClick={() => handleVote("red")}>
            🔴
            <br />
            {state.teams.red.name}
          </button>
          <button className="vote-buttons__blue" onClick={() => handleVote("blue")}>
            🔵
            <br />
            {state.teams.blue.name}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "voting" && hasVotedThisRound) {
    return (
      <div className="phase-view">
        <p className="phase-label">投票を受け付けました。結果をお待ちください。</p>
        {lastVoteAck && !lastVoteAck.accepted && (
          <p className="error">投票が反映されていない可能性があります：{lastVoteAck.reason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="phase-view">
      <p className="phase-label">{PHASE_LABEL[state.phase]}</p>
      <p className="match-context">
        🔴 {state.teams.red.name} vs 🔵 {state.teams.blue.name}
      </p>
    </div>
  );
}

function teamLabel(state: MatchState, team: TeamId): string {
  return `${team === "red" ? "🔴" : "🔵"} ${state.teams[team].name}`;
}
