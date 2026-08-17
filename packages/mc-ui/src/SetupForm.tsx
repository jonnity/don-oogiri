import { useState, type FormEvent } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";
import {
  resolveLastMatchConfig,
  resolveParticipantRoster,
  setLastMatchConfig,
  setParticipantRoster,
} from "./settings.js";

interface SetupFormProps {
  onCreate: (req: CreateMatchRequest) => void;
  isSubmitting: boolean;
  /** 進行中セッションの途中から次の試合を作る場合に渡す。未指定なら（＝最初の試合作成）キャンセルボタンは出さない。 */
  onCancel?: () => void;
}

const LANE_LENGTH = 100;
const DEFAULT_EDGE_TO_EDGE_SECONDS = 120;
const DEFAULT_TEAM_SIZE = 3;
const TEAM_SIZE_OPTIONS = [1, 2, 3] as const;
const DEFAULT_MATCH_TIME_LIMIT_MINUTES = 3;
const PARTICIPANT_ROSTER_DATALIST_ID = "participant-roster";

function emptyMembers(size: number): string[] {
  return Array.from({ length: size }, () => "");
}

function resizeMembers(members: string[], size: number): string[] {
  return Array.from({ length: size }, (_, i) => members[i] ?? "");
}

export function SetupForm({ onCreate, isSubmitting, onCancel }: SetupFormProps) {
  // ゲームのコンフィグのように、前回試合作成時に使った値を次回のデフォルトにする
  // （メンバー名・お題は毎回入力し直すものなのでここには含めない。参加者一覧は別途roster管理）。
  const [lastConfig] = useState(() => resolveLastMatchConfig());
  const [topic, setTopic] = useState("");
  const [teamSize, setTeamSize] = useState<number>(lastConfig?.teamSize ?? DEFAULT_TEAM_SIZE);
  const [redMembers, setRedMembers] = useState(() =>
    emptyMembers(lastConfig?.teamSize ?? DEFAULT_TEAM_SIZE),
  );
  const [blueMembers, setBlueMembers] = useState(() =>
    emptyMembers(lastConfig?.teamSize ?? DEFAULT_TEAM_SIZE),
  );
  const [edgeToEdgeSeconds, setEdgeToEdgeSeconds] = useState(
    lastConfig?.edgeToEdgeSeconds ?? DEFAULT_EDGE_TO_EDGE_SECONDS,
  );
  const [timeLimitEnabled, setTimeLimitEnabled] = useState(lastConfig?.timeLimitEnabled ?? true);
  const [matchTimeLimitMinutes, setMatchTimeLimitMinutes] = useState(
    lastConfig?.matchTimeLimitMinutes ?? DEFAULT_MATCH_TIME_LIMIT_MINUTES,
  );
  const [roster, setRoster] = useState(() => resolveParticipantRoster());

  function handleTeamSizeChange(size: number) {
    setTeamSize(size);
    // 人数を変えても、既存の入力済み名前はできる範囲で保持する
    setRedMembers((prev) => resizeMembers(prev, size));
    setBlueMembers((prev) => resizeMembers(prev, size));
  }

  function handleAddToRoster(name: string) {
    const trimmed = name.trim();
    if (!trimmed || roster.includes(trimmed)) return;
    const next = [...roster, trimmed];
    setRoster(next);
    setParticipantRoster(next);
  }

  function handleRemoveFromRoster(name: string) {
    const next = roster.filter((n) => n !== name);
    setRoster(next);
    setParticipantRoster(next);
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
    if (timeLimitEnabled && matchTimeLimitMinutes <= 0) {
      alert("制限時間は1分以上で入力してください");
      return;
    }
    setLastMatchConfig({ teamSize, edgeToEdgeSeconds, timeLimitEnabled, matchTimeLimitMinutes });
    onCreate({
      config: {
        laneLength: LANE_LENGTH,
        centerToEdgeMs: (edgeToEdgeSeconds * 1000) / 2,
        matchTimeLimitMs: timeLimitEnabled ? matchTimeLimitMinutes * 60 * 1000 : null,
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
      <ParticipantRoster
        roster={roster}
        onAdd={handleAddToRoster}
        onRemove={handleRemoveFromRoster}
      />
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
      <fieldset>
        <legend>試合全体の制限時間</legend>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={timeLimitEnabled}
            onChange={(e) => setTimeLimitEnabled(e.target.checked)}
          />
          制限時間を設ける
        </label>
        <label>
          制限時間(分)。回答中・投票中は消費されず、終了時点で優勢な方の勝ち
          <input
            type="number"
            value={matchTimeLimitMinutes}
            min={1}
            disabled={!timeLimitEnabled}
            onChange={(e) => setMatchTimeLimitMinutes(Number(e.target.value))}
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

interface ParticipantRosterProps {
  roster: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}

/**
 * 事前登録した参加者名のプール。メンバー欄はこのdatalistを参照するのでtype-ahead選択できる
 * （自由入力も引き続き可能）。roster自体はlocalStorageに保存され、試合をまたいで使い回す。
 */
function ParticipantRoster({ roster, onAdd, onRemove }: ParticipantRosterProps) {
  const [newName, setNewName] = useState("");

  function handleAdd() {
    onAdd(newName);
    setNewName("");
  }

  return (
    <fieldset className="participant-roster">
      <legend>参加者一覧（事前登録・任意）</legend>
      <div className="participant-roster__add">
        <input
          value={newName}
          placeholder="参加者名を入力して追加"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" onClick={handleAdd} disabled={!newName.trim()}>
          追加
        </button>
      </div>
      {roster.length > 0 && (
        <ul className="participant-roster__list">
          {roster.map((name) => (
            <li key={name} className="participant-roster__item">
              {name}
              <button type="button" onClick={() => onRemove(name)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <datalist id={PARTICIPANT_ROSTER_DATALIST_ID}>
        {roster.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </fieldset>
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
            list={PARTICIPANT_ROSTER_DATALIST_ID}
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
