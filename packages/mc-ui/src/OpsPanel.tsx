import { useState } from "react";
import type { MatchEvent, MatchState } from "@don-oogiri/engine";

interface OpsPanelProps {
  state: MatchState;
  onSend: (event: MatchEvent) => void;
}

const SPEED_PRESETS = [
  { label: "本番速度", multiplier: 1 },
  { label: "リハ用 5倍速", multiplier: 5 },
  { label: "リハ用 10倍速", multiplier: 10 },
];

/**
 * Phase 5: 運用機能（前進速度のライブ調整、マーカー位置の手動補正、試合リセット、お題の訂正）
 * をまとめたMC操作卓のパネル。トラブルリカバリ用途で普段は触らないため、通常の試合進行操作
 * （MatchControls）とは分ける。折りたたんで隠すのではなく、有効化トグルをオフにした状態で
 * 常に見える位置に置き、中身をグレーアウト＋操作不可（fieldset disabled）にする。
 * 「そういう機能があること」自体は一目でわかり、誤操作は有効化するまで起きない。
 */
export function OpsPanel({ state, onSend }: OpsPanelProps) {
  const [enabled, setEnabled] = useState(false);

  return (
    <div className="ops-panel">
      <div className="ops-panel__header">
        <div>
          <p className="ops-panel__title">運用ツール（速度調整・位置補正・リセット等）</p>
          {!enabled && (
            <p className="ops-panel__hint">誤操作防止のため無効化中。操作するには有効化してください。</p>
          )}
        </div>
        <button
          type="button"
          className="ops-panel__toggle"
          aria-pressed={enabled}
          onClick={() => setEnabled((v) => !v)}
        >
          {enabled ? "運用ツールを無効化" : "運用ツールを有効化"}
        </button>
      </div>
      <fieldset disabled={!enabled} className="ops-panel__body">
        <TopicEditor state={state} onSend={onSend} />
        <SpeedControls state={state} onSend={onSend} />
        <MarkerCorrection state={state} onSend={onSend} />
        <ResetControl onSend={onSend} />
      </fieldset>
    </div>
  );
}

function TopicEditor({ state, onSend }: OpsPanelProps) {
  const [topic, setTopic] = useState(state.topic);

  return (
    <fieldset className="ops-panel__section">
      <legend>お題の訂正</legend>
      <label>
        お題
        <input value={topic} onChange={(e) => setTopic(e.target.value)} />
      </label>
      <button
        disabled={!topic.trim() || topic.trim() === state.topic}
        onClick={() => onSend({ type: "SET_TOPIC", topic: topic.trim() })}
      >
        お題を修正
      </button>
    </fieldset>
  );
}

function SpeedControls({ state, onSend }: OpsPanelProps) {
  return (
    <fieldset className="ops-panel__section">
      <legend>前進速度（ライブ調整・リハーサル早送り）</legend>
      <p>現在の倍率: {state.speedMultiplier}倍</p>
      <div className="ops-panel__speed-presets">
        {SPEED_PRESETS.map((preset) => (
          <button
            key={preset.multiplier}
            disabled={state.speedMultiplier === preset.multiplier}
            onClick={() =>
              onSend({ type: "SET_SPEED_MULTIPLIER", multiplier: preset.multiplier })
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function MarkerCorrection({ state, onSend }: OpsPanelProps) {
  const [position, setPosition] = useState(() =>
    Math.round(state.config.laneLength / 2),
  );
  const correctable =
    (state.phase === "initial_writing" ||
      state.phase === "challenge_writing" ||
      state.phase === "voting") &&
    state.movement.status !== "idle";

  return (
    <fieldset className="ops-panel__section">
      <legend>マーカー位置の手動補正（トラブルリカバリ）</legend>
      {!correctable && <p>現在は補正できません（マーカーが動き出していません）。</p>}
      <label>
        位置（0〜{state.config.laneLength}、0=赤陣地端 / {state.config.laneLength}=青陣地端）
        <input
          type="number"
          min={0}
          max={state.config.laneLength}
          value={position}
          disabled={!correctable}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <button
        disabled={!correctable}
        onClick={() => onSend({ type: "CORRECT_MARKER_POSITION", position })}
      >
        この位置に補正する
      </button>
    </fieldset>
  );
}

function ResetControl({ onSend }: { onSend: (event: MatchEvent) => void }) {
  function handleReset() {
    if (!confirm("試合の進行状態をリセットします（チーム名・お題は維持されます）。よろしいですか？")) {
      return;
    }
    onSend({ type: "RESET_MATCH" });
  }

  return (
    <fieldset className="ops-panel__section">
      <legend>試合リセット</legend>
      <p>チーム名・メンバー・お題・パラメータは維持したまま、進行状態だけをsetupに戻します。</p>
      <button className="ops-panel__reset" onClick={handleReset}>
        試合をリセット
      </button>
    </fieldset>
  );
}
