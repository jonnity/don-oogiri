import { useEffect, useState } from "react";
import { matchTimeLimitExpiry, type MatchState } from "@don-oogiri/engine";

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
 * 試合全体の制限時間の残り表示。制限時間はサーバ権威(matchStartTime + config.matchTimeLimitMs)
 * で判定され、満了時点で優勢なチームの勝ちとしてエンジン側が自動的にfinishedへ遷移させる
 * （このコンポーネントは表示のみで、確定の判定ロジックは持たない）。
 * START_MATCH前(matchStartTime未設定)はまだカウントが始まっていないので、
 * カウントダウンはせず設定されている制限時間をそのまま静的に表示する。
 */
export function MatchTimer({ state, clockOffset }: MatchTimerProps) {
  const timeLimitMs = state.config.matchTimeLimitMs;
  const expiry = matchTimeLimitExpiry(state);
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  useEffect(() => {
    if (expiry === null || state.phase === "finished") return undefined;
    const tick = () => setNow(Date.now() + clockOffset);
    tick();
    const id = setInterval(tick, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [expiry, clockOffset, state.phase]);

  if (timeLimitMs === null) return null;

  if (state.phase === "finished") {
    if (state.matchEndReason !== "time_limit") return null;
    return <p className="match-timer match-timer--expired">{formatMs(0)}</p>;
  }

  if (expiry === null) {
    // まだSTART_MATCH前。カウントダウンはせず、設定値を静止表示するだけ。
    return <p className="match-timer">{formatMs(timeLimitMs)}</p>;
  }

  const remainingMs = Math.max(0, expiry - now);
  const isUrgent = remainingMs <= URGENT_THRESHOLD_MS;

  return (
    <p className={`match-timer${isUrgent ? " match-timer--urgent" : ""}`}>
      {formatMs(remainingMs)}
    </p>
  );
}
