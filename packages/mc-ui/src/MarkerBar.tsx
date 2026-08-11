import { useEffect, useRef, useState } from "react";
import { nextArrivalTime, type MatchState, type TeamId } from "@don-oogiri/engine";

interface MarkerBarProps {
  state: MatchState;
  clockOffset: number;
}

/**
 * どんじゃんけん演出: バーは常時は動かさず、
 * 「先着/指名の瞬間だけグッと動く」静止→スナップの2段階で表現する。
 * - idle→advancing（先着決定）: 自陣の端から中央まで一気に伸びる
 * - advancing中: 見た目は静止（真の到達時間は秒数テキストで表現）
 * - advancing→frozen（指名）: 静止していた位置から実際の到達位置まで一気にぶつかる
 */
export function MarkerBar({ state, clockOffset }: MarkerBarProps) {
  const [renderPosition, setRenderPosition] = useState(() => restPosition(state));
  const prevStatusRef = useRef(state.movement.status);
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const target = restPosition(state);
    if (prevStatus === "idle" && state.movement.status === "advancing" && state.advancingTeam) {
      setRenderPosition(edgePosition(state.advancingTeam, state.config.laneLength));
      const raf = requestAnimationFrame(() => setRenderPosition(target));
      prevStatusRef.current = state.movement.status;
      return () => cancelAnimationFrame(raf);
    }
    setRenderPosition(target);
    prevStatusRef.current = state.movement.status;
    return undefined;
  }, [state]);

  useEffect(() => {
    if (state.movement.status !== "advancing") {
      setNow(Date.now() + clockOffset);
      return;
    }
    let raf: number;
    const tick = () => {
      setNow(Date.now() + clockOffset);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, clockOffset]);

  const percent = (renderPosition / state.config.laneLength) * 100;
  const hasStarted = state.movement.status !== "idle";
  const arrivalTime = nextArrivalTime(state);
  const secondsToEdge =
    arrivalTime !== null ? Math.max(0, (arrivalTime - now) / 1000) : null;

  return (
    <div className="marker-bar">
      <div className="marker-bar__track">
        <span className="marker-bar__edge marker-bar__edge--red">
          🔴 {state.teams.red.name}
        </span>
        <div className="marker-bar__rail">
          {hasStarted && (
            <>
              <div
                className="marker-bar__fill marker-bar__fill--red"
                style={{ width: `${percent}%` }}
              />
              <div
                className="marker-bar__fill marker-bar__fill--blue"
                style={{ width: `${100 - percent}%` }}
              />
            </>
          )}
          <div className="marker-bar__marker" style={{ left: `${percent}%` }} />
        </div>
        <span className="marker-bar__edge marker-bar__edge--blue">
          🔵 {state.teams.blue.name}
        </span>
      </div>
      <p className="marker-bar__position">{describeStatus(state, secondsToEdge)}</p>
    </div>
  );
}

/** advancing中はレグ開始位置で静止、frozen中は実際の到達位置。idleは中央。 */
function restPosition(state: MatchState): number {
  const { movement, config } = state;
  if (movement.status === "advancing") return movement.startPosition;
  if (movement.status === "frozen") return movement.position;
  return config.laneLength / 2;
}

function edgePosition(team: TeamId, laneLength: number): number {
  return team === "red" ? 0 : laneLength;
}

function describeStatus(state: MatchState, secondsToEdge: number | null): string {
  if (secondsToEdge !== null && state.advancingTeam) {
    return `${teamEmoji(state.advancingTeam)} 到達まで残り ${secondsToEdge.toFixed(1)}秒`;
  }
  if (state.movement.status === "frozen") {
    return "一時停止中（投票待ち）";
  }
  return "開始待ち";
}

function teamEmoji(team: TeamId): string {
  return team === "red" ? "🔴" : "🔵";
}
