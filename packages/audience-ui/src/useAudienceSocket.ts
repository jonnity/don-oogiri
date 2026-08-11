import { useEffect, useRef, useState } from "react";
import type { ClientMessage, MatchState, ServerMessage, TeamId } from "@don-oogiri/engine";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface VoteAck {
  accepted: boolean;
  reason?: string;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export interface AudienceSocket {
  state: MatchState | null;
  clockOffset: number;
  status: ConnectionStatus;
  lastVoteAck: VoteAck | null;
  sendVote: (team: TeamId) => void;
}

/**
 * 観客ページ用のWebSocket接続。スマホのスリープ復帰でソケットが切れるケースを
 * 想定し、切断時は指数バックオフで自動再接続し、加えてタブが再びvisibleになった
 * 瞬間にも即座に再接続を試みる（タイマーだけではロック中に発火しないため）。
 */
export function useAudienceSocket(
  baseUrl: string,
  matchId: string,
  voterId: string,
): AudienceSocket {
  const [state, setState] = useState<MatchState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastVoteAck, setLastVoteAck] = useState<VoteAck | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function scheduleReconnect() {
      setStatus("closed");
      if (unmountedRef.current || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, reconnectDelayRef.current);
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 2,
        MAX_RECONNECT_DELAY_MS,
      );
    }

    function connect() {
      const wsUrl = `${baseUrl.replace(/^http/, "ws")}/api/matches/${matchId}/ws?voterId=${encodeURIComponent(voterId)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setStatus("connecting");

      ws.addEventListener("open", () => {
        setStatus("open");
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
      });
      ws.addEventListener("message", (event) => {
        const message: ServerMessage = JSON.parse(event.data as string);
        if (message.type === "state") {
          setState(message.state);
          setClockOffset(message.serverTime - Date.now());
        } else if (message.type === "vote_ack") {
          setLastVoteAck({ accepted: message.accepted, reason: message.reason });
        }
      });
      ws.addEventListener("close", scheduleReconnect);
      ws.addEventListener("error", () => ws.close());
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      clearReconnectTimer();
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
      connect();
    }

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unmountedRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [baseUrl, matchId, voterId]);

  function sendVote(team: TeamId): void {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { type: "event", event: { type: "AUDIENCE_VOTE_CAST", team } };
    ws.send(JSON.stringify(message));
  }

  return { state, clockOffset, status, lastVoteAck, sendVote };
}
