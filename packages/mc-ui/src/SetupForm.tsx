import { useState, type FormEvent } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";

interface SetupFormProps {
  onCreate: (req: CreateMatchRequest) => void;
  isSubmitting: boolean;
  /** 進行中セッションの途中から次の試合を作る場合に渡す。未指定なら（＝最初の試合作成）キャンセルボタンは出さない。 */
  onCancel?: () => void;
}

const LANE_LENGTH = 100;
const DEFAULT_EDGE_TO_EDGE_SECONDS = 60;
const DEFAULT_TEAM_SIZE = 3;
const TEAM_SIZE_OPTIONS = [1, 2, 3] as const;

function emptyMembers(size: number): string[] {
  return Array.from({ length: size }, () => "");
}

function resizeMembers(members: string[], size: number): string[] {
  return Array.from({ length: size }, (_, i) => members[i] ?? "");
}

export function SetupForm({ onCreate, isSubmitting, onCancel }: SetupFormProps) {
  const [topic, setTopic] = useState("");
  const [teamSize, setTeamSize] = useState<number>(DEFAULT_TEAM_SIZE);
  const [redMembers, setRedMembers] = useState(() => emptyMembers(DEFAULT_TEAM_SIZE));
  const [blueMembers, setBlueMembers] = useState(() => emptyMembers(DEFAULT_TEAM_SIZE));
  const [edgeToEdgeSeconds, setEdgeToEdgeSeconds] = useState(
    DEFAULT_EDGE_TO_EDGE_SECONDS,
  );

  function handleTeamSizeChange(size: number) {
    setTeamSize(size);
    // 人数を変えても、既存の入力済み名前はできる範囲で保持する
    setRedMembers((prev) => resizeMembers(prev, size));
    setBlueMembers((prev) => resizeMembers(prev, size));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      alert("お題を入力してください");
      return;
    }
    if (redMembers.some((m) => !m.trim()) || blueMembers.some((m) => !m.trim())) {
      alert(`各チーム${teamSize}人のメンバー名をすべて入力してください`);
      return;
    }
    if (edgeToEdgeSeconds <= 0) {
      alert("到達時間は1秒以上で入力してください");
      return;
    }
    onCreate({
      config: {
        laneLength: LANE_LENGTH,
        centerToEdgeMs: (edgeToEdgeSeconds * 1000) / 2,
      },
      red: { name: "赤", members: redMembers },
      blue: { name: "青", members: blueMembers },
      topic: topic.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="setup-form">
      <h2>試合作成</h2>
      <fieldset>
        <legend>お題</legend>
        <label>
          お題
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例: 意外な二刀流"
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>チームの人数</legend>
        <div className="team-size-picker">
          {TEAM_SIZE_OPTIONS.map((size) => (
            <label key={size} className="team-size-picker__option">
              <input
                type="radio"
                name="teamSize"
                checked={teamSize === size}
                onChange={() => handleTeamSizeChange(size)}
              />
              {size}人{size === 1 ? "（タイマン）" : ""}
            </label>
          ))}
        </div>
      </fieldset>
      <TeamFields
        color="red"
        label="🔴 赤"
        members={redMembers}
        setMembers={setRedMembers}
      />
      <TeamFields
        color="blue"
        label="🔵 青"
        members={blueMembers}
        setMembers={setBlueMembers}
      />
      <fieldset>
        <legend>パラメータ</legend>
        <label>
          端から端までの到達時間(秒)
          <input
            type="number"
            value={edgeToEdgeSeconds}
            min={1}
            onChange={(e) => setEdgeToEdgeSeconds(Number(e.target.value))}
          />
        </label>
      </fieldset>
      <div className="setup-form__actions">
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "作成中..." : "試合を作成"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        )}
      </div>
    </form>
  );
}

interface TeamFieldsProps {
  color: "red" | "blue";
  label: string;
  members: string[];
  setMembers: (v: string[]) => void;
}

function TeamFields({ color, label, members, setMembers }: TeamFieldsProps) {
  return (
    <fieldset className={`team-fields team-fields--${color}`}>
      <legend>{label}</legend>
      {members.map((m, i) => (
        <label key={i}>
          メンバー{i + 1}
          <input
            value={m}
            onChange={(e) => {
              const next = [...members];
              next[i] = e.target.value;
              setMembers(next);
            }}
          />
        </label>
      ))}
    </fieldset>
  );
}
