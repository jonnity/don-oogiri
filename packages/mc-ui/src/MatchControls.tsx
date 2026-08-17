import { useEffect, useState } from "react";
import { currentWriters, type MatchEvent, type MatchState, type TeamId } from "@don-oogiri/engine";

interface MatchControlsProps {
  state: MatchState;
  onSend: (event: MatchEvent) => void;
}

const PHASE_LABEL: Record<MatchState["phase"], string> = {
  setup: "準備中",
  initial_writing: "INITIAL_WRITING（両チーム執筆中）",
  voting: "VOTE（観客投票中）",
  challenge_writing: "CHALLENGE_WRITING",
  tie_writing: "TIE_WRITING（同数につき両チーム書き直し中）",
  finished: "試合終了",
};

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * 回答者席を見ながら操作できるよう、指名系の操作を矢印キーに割り当てる。
 * どちらの指名か指定する必要がない場合（NOMINATE）はいずれかの矢印キー、
 * 赤/青を指定する必要がある場合（FIRST_DONE）は赤=左キー・青=右キー。
 * renderActionsが今実際に表示しているアクションとだけ対応させ、投票確定(CLOSE_VOTING)や
 * 試合開始(START_MATCH)など誤操作の被害が大きい操作は割り当てない。
 */
function useNominationHotkeys(state: MatchState, onSend: (event: MatchEvent) => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat || !ARROW_KEYS.has(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (target && TEXT_INPUT_TAGS.has(target.tagName)) return;

      const inBothWritingPhase =
        state.phase === "initial_writing" || state.phase === "tie_writing";

      if (inBothWritingPhase && !state.bothWritingFirstDone) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onSend({ type: "FIRST_DONE", team: "red" });
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onSend({ type: "FIRST_DONE", team: "blue" });
        }
        return;
      }

      if (
        (inBothWritingPhase || state.phase === "challenge_writing") &&
        state.movement.status === "advancing"
      ) {
        e.preventDefault();
        onSend({ type: "NOMINATE" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.phase, state.bothWritingFirstDone, state.movement.status, onSend]);
}

export function MatchControls({ state, onSend }: MatchControlsProps) {
  const writers = currentWriters(state);
  useNominationHotkeys(state, onSend);

  return (
    <div className="match-controls">
      <h2>状態</h2>
      <WritingStatusBanner state={state} writers={writers} />
      <dl className="status-grid">
        <dt>お題</dt>
        <dd className="status-grid__topic">{state.topic}</dd>
        <dt>フェーズ</dt>
        <dd>{PHASE_LABEL[state.phase]}</dd>
        <dt>進んでる側</dt>
        <dd>{state.advancingTeam ? teamLabel(state, state.advancingTeam) : "-"}</dd>
        <dt>阻止する側</dt>
        <dd>{state.defendingTeam ? teamLabel(state, state.defendingTeam) : "-"}</dd>
        <dt>今の回答者（🔴/🔵）</dt>
        <dd>
          {state.currentAnswerer.red ?? "-"} / {state.currentAnswerer.blue ?? "-"}
        </dd>
        <dt>マーカー状態</dt>
        <dd>{state.movement.status}</dd>
      </dl>

      <div className="actions">{renderActions(state, onSend)}</div>

      {state.phase === "finished" && (
        <p className="winner-banner">
          {state.winner ? `🏆 勝者: ${teamLabel(state, state.winner)}` : "🤝 引き分け"}
          {state.matchEndReason === "time_limit" && "（時間切れ）"}
        </p>
      )}
    </div>
  );
}

/**
 * 「今どちらのチームが回答を書くべきか」を一目でわかるようにするための強調表示。
 * currentWriters()が返す0〜2件をそのままチーム色でバッジ化する。
 */
function WritingStatusBanner({
  state,
  writers,
}: {
  state: MatchState;
  writers: { team: TeamId; name: string }[];
}) {
  if (writers.length === 0) return null;

  return (
    <p className="writing-status">
      {writers.length === 2 ? (
        <span className="writing-status__label">両チームが回答を書いています：</span>
      ) : (
        <span className="writing-status__label">回答を書いているのは：</span>
      )}
      {writers.map((w) => (
        <span key={w.team} className={`writing-status__badge writing-status__badge--${w.team}`}>
          {teamLabel(state, w.team)} / {w.name}
        </span>
      ))}
    </p>
  );
}

function teamLabel(state: MatchState, team: TeamId): string {
  return `${team === "red" ? "🔴" : "🔵"} ${state.teams[team].name}`;
}

function renderActions(state: MatchState, onSend: (event: MatchEvent) => void) {
  if (state.phase === "setup") {
    return <button onClick={() => onSend({ type: "START_MATCH" })}>試合開始</button>;
  }

  const inBothWritingPhase = state.phase === "initial_writing" || state.phase === "tie_writing";

  if (inBothWritingPhase && !state.bothWritingFirstDone) {
    return (
      <>
        <button onClick={() => onSend({ type: "FIRST_DONE", team: "red" })}>
          🔴 赤チーム 執筆完了（先着）
        </button>
        <button onClick={() => onSend({ type: "FIRST_DONE", team: "blue" })}>
          🔵 青チーム 執筆完了（先着）
        </button>
      </>
    );
  }

  if ((inBothWritingPhase || state.phase === "challenge_writing") && state.movement.status === "advancing") {
    return (
      <button onClick={() => onSend({ type: "NOMINATE" })}>指名（前進ストップ→投票開始）</button>
    );
  }

  if (state.phase === "voting") {
    return <VotingControls state={state} onSend={onSend} />;
  }

  return null;
}

function VotingControls({ state, onSend }: MatchControlsProps) {
  return (
    <div className="voting-controls">
      <p className="audience-tally">
        観客投票 現在の集計: 🔴 {state.audienceVotes.red} - 🔵 {state.audienceVotes.blue}
      </p>
      <button className="close-voting" onClick={() => onSend({ type: "CLOSE_VOTING" })}>
        投票を締め切る（この集計で確定）
      </button>
      <details className="manual-vote-fallback">
        <summary>観客投票を使わない場合：票数を手入力して確定</summary>
        <VoteForm onSend={onSend} />
      </details>
    </div>
  );
}

function VoteForm({ onSend }: { onSend: (event: MatchEvent) => void }) {
  const [redVotes, setRedVotes] = useState(0);
  const [blueVotes, setBlueVotes] = useState(0);

  return (
    <div className="vote-form">
      <label>
        🔴 赤 票数
        <input
          type="number"
          min={0}
          value={redVotes}
          onChange={(e) => setRedVotes(Number(e.target.value))}
        />
      </label>
      <label>
        🔵 青 票数
        <input
          type="number"
          min={0}
          value={blueVotes}
          onChange={(e) => setBlueVotes(Number(e.target.value))}
        />
      </label>
      <button onClick={() => onSend({ type: "VOTE_RESULT", redVotes, blueVotes })}>
        投票確定
      </button>
    </div>
  );
}
