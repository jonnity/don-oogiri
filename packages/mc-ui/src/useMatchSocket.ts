import { useEffect, useRef, useState } from "react";
import type { ClientMessage, MatchEvent, MatchState, ServerMessage } from "@don-oogiri/engine";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export interface MatchSocket {
  state: MatchState | null;
  /** serverTime - Date.now() at the moment the last snapshot arrived。マーカー補間で現在時刻に加算して使う。 */
  clockOffset: number;
  status: ConnectionStatus;
  lastError: string | null;
  sendEvent: (event: MatchEvent) => void;
}

export function useMatchSocket(baseUrl: string, matchId: string | null): MatchSocket {
  const [state, setState] = useState<MatchState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bestClockOffsetRef = useRef(-Infinity);

  useEffect(() => {
    if (!matchId) {
      setState(null);
      setStatus("idle");
      return;
    }

    bestClockOffsetRef.current = -Infinity;
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}/api/matches/${matchId}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus("connecting");

    ws.addEventListener("open", () => setStatus("open"));
    ws.addEventListener("close", () => setStatus("closed"));
    ws.addEventListener("error", () => setStatus("closed"));
    ws.addEventListener("message", (event) => {
      const message: ServerMessage = JSON.parse(event.data as string);
      if (message.type === "state") {
        setState(message.state);
        // serverTime - Date.now() は「真のクロックオフセット - 片道ネットワーク遅延」を表す。
        // 遅延は毎回変動しノイズになるので、遅延が最小だった（＝この値が最大だった）サンプルを
        // 採用し続けることで、マーカー位置補間が遅延ジッターで一瞬後退して見える現象を防ぐ。
        const sample = message.serverTime - Date.now();
        if (sample > bestClockOffsetRef.current) {
          bestClockOffsetRef.current = sample;
          setClockOffset(sample);
        }
        setLastError(null);
      } else if (message.type === "error") {
        setLastError(message.message);
      }
      // vote_ackはAUDIENCE_VOTE_CASTを送るクライアント(観客ページ)向け。MC操作卓は無視してよい。
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [baseUrl, matchId]);

  function sendEvent(event: MatchEvent): void {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { type: "event", event };
    ws.send(JSON.stringify(message));
  }

  return { state, clockOffset, status, lastError, sendEvent };
}
