import { useState, type FormEvent } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";

interface SetupFormProps {
  onCreate: (req: CreateMatchRequest) => void;
  isSubmitting: boolean;
}

const LANE_LENGTH = 100;
const DEFAULT_EDGE_TO_EDGE_SECONDS = 180;

export function SetupForm({ onCreate, isSubmitting }: SetupFormProps) {
  const [redMembers, setRedMembers] = useState(["", "", ""]);
  const [blueMembers, setBlueMembers] = useState(["", "", ""]);
  const [edgeToEdgeSeconds, setEdgeToEdgeSeconds] = useState(
    DEFAULT_EDGE_TO_EDGE_SECONDS,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (redMembers.some((m) => !m.trim()) || blueMembers.some((m) => !m.trim())) {
      alert("各チーム3人のメンバー名をすべて入力してください");
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
      red: { name: "赤", members: redMembers as [string, string, string] },
      blue: { name: "青", members: blueMembers as [string, string, string] },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="setup-form">
      <h2>試合作成</h2>
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
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "作成中..." : "試合を作成"}
      </button>
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
