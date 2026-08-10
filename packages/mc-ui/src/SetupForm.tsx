import { useState, type FormEvent } from "react";
import type { CreateMatchRequest } from "@don-oogiri/engine";

interface SetupFormProps {
  onCreate: (req: CreateMatchRequest) => void;
  isSubmitting: boolean;
}

const DEFAULT_LANE_LENGTH = 100;
const DEFAULT_CENTER_TO_EDGE_MS = 90_000;

export function SetupForm({ onCreate, isSubmitting }: SetupFormProps) {
  const [redName, setRedName] = useState("赤チーム");
  const [redMembers, setRedMembers] = useState(["", "", ""]);
  const [blueName, setBlueName] = useState("青チーム");
  const [blueMembers, setBlueMembers] = useState(["", "", ""]);
  const [laneLength, setLaneLength] = useState(DEFAULT_LANE_LENGTH);
  const [centerToEdgeMs, setCenterToEdgeMs] = useState(DEFAULT_CENTER_TO_EDGE_MS);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (redMembers.some((m) => !m.trim()) || blueMembers.some((m) => !m.trim())) {
      alert("各チーム3人のメンバー名をすべて入力してください");
      return;
    }
    onCreate({
      config: { laneLength, centerToEdgeMs },
      red: { name: redName, members: redMembers as [string, string, string] },
      blue: { name: blueName, members: blueMembers as [string, string, string] },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="setup-form">
      <h2>試合作成</h2>
      <TeamFields
        color="red"
        label="🔴 赤チーム"
        name={redName}
        setName={setRedName}
        members={redMembers}
        setMembers={setRedMembers}
      />
      <TeamFields
        color="blue"
        label="🔵 青チーム"
        name={blueName}
        setName={setBlueName}
        members={blueMembers}
        setMembers={setBlueMembers}
      />
      <fieldset>
        <legend>パラメータ</legend>
        <label>
          レーン全長
          <input
            type="number"
            value={laneLength}
            min={1}
            onChange={(e) => setLaneLength(Number(e.target.value))}
          />
        </label>
        <label>
          中央→端の到達時間(ms)
          <input
            type="number"
            value={centerToEdgeMs}
            min={1}
            onChange={(e) => setCenterToEdgeMs(Number(e.target.value))}
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
  name: string;
  setName: (v: string) => void;
  members: string[];
  setMembers: (v: string[]) => void;
}

function TeamFields({ color, label, name, setName, members, setMembers }: TeamFieldsProps) {
  return (
    <fieldset className={`team-fields team-fields--${color}`}>
      <legend>{label}</legend>
      <label>
        チーム名
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
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
