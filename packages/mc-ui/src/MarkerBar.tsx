import { useEffect, useRef, useState } from "react";
import { getMarkerPosition, nextArrivalTime, type MatchState, type TeamId } from "@don-oogiri/engine";

interface MarkerBarProps {
  state: MatchState;
  clockOffset: number;
}

/**
 * どんじゃんけん演出: 先着が決まった瞬間だけ「自陣の端から一気に伸びる」スナップで見せ、
 * advancing中はサーバ権威の位置（`getMarkerPosition`）を毎フレーム補間して滑らかに追従させる。
 */
export function MarkerBar({ state, clockOffset }: MarkerBarProps) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  const [snapFrom, setSnapFrom] = useState<number | null>(null);
  const prevStatusRef = useRef(state.movement.status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = state.movement.status;
    if (prevStatus === "idle" && state.movement.status === "advancing" && state.advancingTeam) {
      setSnapFrom(edgePosition(state.advancingTeam, state.config.laneLength));
      const raf = requestAnimationFrame(() => setSnapFrom(null));
      return () => cancelAnimationFrame(raf);
    }
    setSnapFrom(null);
    return undefined;
  }, [state]);

  // `now`はDate.now()を毎フレーム取り直さず、この時点のDate.now()を一度だけ基準点として
  // 記録し、以降はperformance.now()（単調増加が保証される）の経過分だけ進める。
  // Date.now()は壁時計なので、OSのクロック補正（WSL2のホスト時刻再同期など）で
  // 一瞬巻き戻ることがあり、毎フレーム取り直すとマーカーが後退して見える原因になる。
  // 念のためMath.maxで単調増加も強制し、他要因での後退も構造的に防ぐ。
  useEffect(() => {
    const nowAnchor = Date.now() + clockOffset;
    const perfAnchor = performance.now();
    setNow((prev) => Math.max(prev, nowAnchor));
    if (state.movement.status !== "advancing") return undefined;
    let raf: number;
    const tick = () => {
      setNow((prev) => Math.max(prev, nowAnchor + (performance.now() - perfAnchor)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, clockOffset]);

  const renderPosition = snapFrom ?? getMarkerPosition(state, now);
  const percent = (renderPosition / state.config.laneLength) * 100;
  const hasStarted = state.movement.status !== "idle";
  const arrivalTime = nextArrivalTime(state);
  const secondsToEdge =
    arrivalTime !== null ? Math.max(0, (arrivalTime - now) / 1000) : null;
  // advancing中は毎フレーム実位置を反映するので、CSS transitionに頼らず即時反映する
  // （450msのtransitionに16ms間隔で新しい目標値を与え続けると、レンダラによっては
  // リターゲティングが追いつかず視覚的に静止して見えることがあるため）。
  const isTicking = snapFrom === null && state.movement.status === "advancing";
  const noTransitionStyle = isTicking ? { transitionDuration: "0ms" } : undefined;

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
                style={{ width: `${percent}%`, ...noTransitionStyle }}
              />
              <div
                className="marker-bar__fill marker-bar__fill--blue"
                style={{ width: `${100 - percent}%`, ...noTransitionStyle }}
              />
            </>
          )}
          <div
            className="marker-bar__marker"
            style={{ left: `${percent}%`, ...noTransitionStyle }}
          />
        </div>
        <span className="marker-bar__edge marker-bar__edge--blue">
          🔵 {state.teams.blue.name}
        </span>
      </div>
      <p className={`marker-bar__status marker-bar__status--${statusTone(state)}`}>
        {describeStatus(state, secondsToEdge)}
      </p>
    </div>
  );
}

function edgePosition(team: TeamId, laneLength: number): number {
  return team === "red" ? 0 : laneLength;
}

/** ステータス表示の色調（バッジのCSS用）。advancing中はそのチーム色、それ以外は中立色。 */
function statusTone(state: MatchState): "red" | "blue" | "neutral" {
  if (state.movement.status === "advancing" && state.advancingTeam) {
    return state.advancingTeam;
  }
  return "neutral";
}

/**
 * 短い一言ステータス。「🔴進行中」「🔵進行中」「両チーム回答中」「投票中」の
 * トンマナに合わせる。到達までの残り秒数は進行中の場合のみ補足として括弧書きで添える
 * （secondsToEdgeを渡さない呼び出し元では括弧書きなしの短い形になる）。
 * NOMINATE(前進停止)と投票開始は同一アクションなので、「回答中」に相当する中間状態は存在しない:
 * movementがadvancingでなければidle(試合開始直後)かfrozen(同数書き直し直前)のいずれかで、
 * どちらも両チームがまだ書き終えていない「両チーム回答中」を意味する。
 */
export function describeStatus(state: MatchState, secondsToEdge: number | null = null): string {
  if (state.phase === "setup") return "準備中";
  if (state.phase === "finished") return "試合終了";
  if (state.phase === "voting") return "投票中";
  if (state.movement.status === "advancing" && state.advancingTeam) {
    const countdown = secondsToEdge !== null ? `（残り${secondsToEdge.toFixed(1)}秒）` : "";
    return `${teamEmoji(state.advancingTeam)}進行中${countdown}`;
  }
  return "両チーム回答中";
}

function teamEmoji(team: TeamId): string {
  return team === "red" ? "🔴" : "🔵";
}
