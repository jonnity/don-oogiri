import { useEffect, useState } from "react";
import { currentWriters, type MatchEvent, type MatchState, type TeamId } from "@don-oogiri/engine";

interface MatchControlsProps {
  state: MatchState;
  onSend: (event: MatchEvent) => void;
}

/**
 * 投影画面（MarkerBar.describeStatus）と同じ言葉遣いに揃えた、フェーズの短い説明。
 * MCと投影画面を見比べたときに表記が食い違わないようにする。
 */
const PHASE_LABEL: Record<MatchState["phase"], string> = {
  setup: "準備中",
  initial_writing: "両チーム回答中",
  voting: "投票中",
  challenge_writing: "阻止する側が挑戦の回答を執筆中",
  tie_writing: "同数につき両チーム書き直し中（両チーム回答中）",
  finished: "試合終了",
};

type HotkeyId = "start_match" | "first_done_red" | "first_done_blue" | "nominate" | "close_voting";

interface HotkeyAction {
  id: HotkeyId;
  event: MatchEvent;
  keys: readonly string[];
  /** ボタン脇・凡例に表示する短いラベル。 */
  keyHint: string;
}

const ANY_ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
const ANY_ARROW_HINT = "矢印キー";
const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * 今この瞬間キーボードから叩ける操作の一覧（renderActionsが表示するボタンと一対一）。
 * キー割り当てのボタン表示(KeyHint)とキー入力の実処理(useHotkeys)の両方がこの一箇所だけを
 * 参照するようにして、表示と実際の挙動がズレないようにする。
 * どちらのチームか指定する必要がある操作（執筆完了）は赤=左キー・青=右キー、
 * 指定不要な操作（試合開始・指名・投票締め切り）はいずれかの矢印キー。
 */
function getHotkeyActions(state: MatchState): HotkeyAction[] {
  if (state.phase === "setup") {
    return [
      { id: "start_match", event: { type: "START_MATCH" }, keys: ANY_ARROW_KEYS, keyHint: ANY_ARROW_HINT },
    ];
  }

  const inBothWritingPhase = state.phase === "initial_writing" || state.phase === "tie_writing";

  if (inBothWritingPhase && !state.bothWritingFirstDone) {
    return [
      { id: "first_done_red", event: { type: "FIRST_DONE", team: "red" }, keys: ["ArrowLeft"], keyHint: "←" },
      { id: "first_done_blue", event: { type: "FIRST_DONE", team: "blue" }, keys: ["ArrowRight"], keyHint: "→" },
    ];
  }

  if ((inBothWritingPhase || state.phase === "challenge_writing") && state.movement.status === "advancing") {
    return [{ id: "nominate", event: { type: "NOMINATE" }, keys: ANY_ARROW_KEYS, keyHint: ANY_ARROW_HINT }];
  }

  if (state.phase === "voting") {
    return [
      { id: "close_voting", event: { type: "CLOSE_VOTING" }, keys: ANY_ARROW_KEYS, keyHint: ANY_ARROW_HINT },
    ];
  }

  return [];
}

/**
 * 回答者席を見ながら操作できるよう、getHotkeyActionsが今有効だとする操作を矢印キーで叩けるようにする。
 * 観客投票を使わない場合の票数手入力(VoteForm)や運用ツール(OpsPanel)など、進行の主線から外れる・
 * 数値入力を伴う操作にはキーを割り当てない。
 */
function useHotkeys(state: MatchState, onSend: (event: MatchEvent) => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && TEXT_INPUT_TAGS.has(target.tagName)) return;

      const action = getHotkeyActions(state).find((a) => a.keys.includes(e.key));
      if (!action) return;
      e.preventDefault();
      onSend(action.event);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, onSend]);
}

export function MatchControls({ state, onSend }: MatchControlsProps) {
  const writers = currentWriters(state);
  useHotkeys(state, onSend);

  return (
    <div className="match-controls">
      <h2>状態</h2>
      <p className="hotkey-legend">
        ⌨️ 矢印キーで操作可（対応する操作はボタンに表示）。赤/青の指定が要る操作は 🔴=←
        /🔵=→、不要な操作はいずれかの矢印キー
      </p>
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

function KeyHint({ hotkeys, id }: { hotkeys: HotkeyAction[]; id: HotkeyId }) {
  const label = hotkeys.find((a) => a.id === id)?.keyHint;
  if (!label) return null;
  return <span className="key-hint">{label}</span>;
}

function renderActions(state: MatchState, onSend: (event: MatchEvent) => void) {
  const hotkeys = getHotkeyActions(state);

  if (state.phase === "setup") {
    return (
      <button onClick={() => onSend({ type: "START_MATCH" })}>
        試合開始
        <KeyHint hotkeys={hotkeys} id="start_match" />
      </button>
    );
  }

  const inBothWritingPhase = state.phase === "initial_writing" || state.phase === "tie_writing";

  if (inBothWritingPhase && !state.bothWritingFirstDone) {
    return (
      <>
        <button onClick={() => onSend({ type: "FIRST_DONE", team: "red" })}>
          🔴 赤チーム 執筆完了（先着）
          <KeyHint hotkeys={hotkeys} id="first_done_red" />
        </button>
        <button onClick={() => onSend({ type: "FIRST_DONE", team: "blue" })}>
          🔵 青チーム 執筆完了（先着）
          <KeyHint hotkeys={hotkeys} id="first_done_blue" />
        </button>
      </>
    );
  }

  if ((inBothWritingPhase || state.phase === "challenge_writing") && state.movement.status === "advancing") {
    return (
      <button onClick={() => onSend({ type: "NOMINATE" })}>
        指名（前進ストップ→投票開始）
        <KeyHint hotkeys={hotkeys} id="nominate" />
      </button>
    );
  }

  if (state.phase === "voting") {
    return <VotingControls state={state} onSend={onSend} />;
  }

  return null;
}

function VotingControls({ state, onSend }: MatchControlsProps) {
  const hotkeys = getHotkeyActions(state);

  return (
    <div className="voting-controls">
      <p className="audience-tally">
        観客投票 現在の集計: 🔴 {state.audienceVotes.red} - 🔵 {state.audienceVotes.blue}
      </p>
      <button className="close-voting" onClick={() => onSend({ type: "CLOSE_VOTING" })}>
        投票を締め切る（この集計で確定）
        <KeyHint hotkeys={hotkeys} id="close_voting" />
      </button>
      <fieldset className="manual-vote-fallback">
        <legend>観客投票を使わない場合：票数を手入力して確定</legend>
        <VoteForm onSend={onSend} />
      </fieldset>
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
