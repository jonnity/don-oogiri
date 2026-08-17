import { useEffect, useState } from "react";
import { matchTimeLimitRemainingMs, type MatchState } from "@don-oogiri/engine";

interface MatchTimerProps {
  state: MatchState;
  clockOffset: number;
}

const URGENT_THRESHOLD_MS = 30_000;
const TICK_INTERVAL_MS = 250;

function formatMs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 試合全体の制限時間の残り表示。マーカーがadvancingだった実時間だけを消費するため
 * （回答中/投票中の時間稼ぎは圧迫しない）、カウントダウンするのはadvancing中だけで、
 * それ以外（未開始・回答中の執筆待ち・投票中）は残り時間を静的に表示する。
 * 消化しきった後もadvancingが続く場合（サドンデス：逆転するか阻止されるまで試合は続く。
 * エンジン側の判定ロジックはmaybeFinishByTimeLimit参照）は「延長中」を表示する。
 */
export function MatchTimer({ state, clockOffset }: MatchTimerProps) {
  const timeLimitMs = state.config.matchTimeLimitMs;
  const isAdvancing = state.movement.status === "advancing";
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  useEffect(() => {
    if (!isAdvancing || state.phase === "finished") return undefined;
    const tick = () => setNow(Date.now() + clockOffset);
    tick();
    const id = setInterval(tick, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAdvancing, clockOffset, state.phase]);

  if (timeLimitMs === null) return null;

  if (state.phase === "finished") {
    if (state.matchEndReason !== "time_limit") return null;
    return <p className="match-timer match-timer--expired">{formatMs(0)}</p>;
  }

  // configで制限時間ありと確認済みのため、この時点でnullになることはない。
  const remainingMs = matchTimeLimitRemainingMs(state, now)!;
  const isOvertime = remainingMs <= 0;
  const isUrgent = !isOvertime && remainingMs <= URGENT_THRESHOLD_MS;
  const className = [
    "match-timer",
    isUrgent && "match-timer--urgent",
    isOvertime && "match-timer--overtime",
  ]
    .filter(Boolean)
    .join(" ");

  return <p className={className}>{isOvertime ? "延長中" : formatMs(remainingMs)}</p>;
}
