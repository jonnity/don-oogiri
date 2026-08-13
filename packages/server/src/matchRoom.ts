import {
  checkArrival,
  createMatch,
  IllegalTransitionError,
  nextArrivalTime,
  transition,
  type ClientMessage,
  type CreateMatchRequest,
  type MatchState,
  type ServerMessage,
  type TeamId,
} from "@don-oogiri/engine";
import type { Env } from "./env.js";

const STORAGE_KEY = "match";

/**
 * Phase 5より前に保存されたMatchState(storage)にはtopic/qrVisible/speedMultiplierが
 * 存在しない。デシリアライズ直後に既定値で補い、NaN速度などの壊れた状態で復元されるのを防ぐ。
 */
function normalizeMatch(match: MatchState): MatchState {
  return {
    ...match,
    topic: match.topic ?? "",
    qrVisible: match.qrVisible ?? true,
    speedMultiplier: match.speedMultiplier ?? 1,
  };
}

export class MatchRoom implements DurableObject {
  private state: DurableObjectState;
  private sessions = new Set<WebSocket>();
  /** 観客の投票dedup用。voterIdはURLクエリ(?voterId=)でWebSocket接続ごとに紐づける。 */
  private voterIds = new Map<WebSocket, string>();
  /** voterId -> このラウンドで最後に投票したチーム。同一ラウンド内の再選択（票の変更）を検知するために使う。
   * DO再起動でリセットされるが、イベント用途の緩い不正対策として許容する(spec: 不正対策はゆるくてよい)。 */
  private votedTeamByVoter = new Map<string, { round: number; team: TeamId }>();
  private match: MatchState | null = null;
  private loaded = false;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<MatchState>(STORAGE_KEY);
    this.match = stored ? normalizeMatch(stored) : null;
    this.loaded = true;
  }

  private async save(match: MatchState): Promise<void> {
    this.match = match;
    await this.state.storage.put(STORAGE_KEY, match);
    await this.syncAlarm(match);
    this.broadcast(match);
  }

  private async syncAlarm(match: MatchState): Promise<void> {
    const arrivalTime = nextArrivalTime(match);
    if (arrivalTime === null) {
      await this.state.storage.deleteAlarm();
    } else {
      await this.state.storage.setAlarm(arrivalTime);
    }
  }

  private broadcast(match: MatchState): void {
    const message: ServerMessage = {
      type: "state",
      state: match,
      serverTime: Date.now(),
    };
    const payload = JSON.stringify(message);
    for (const ws of this.sessions) {
      try {
        ws.send(payload);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname.endsWith("/ws")) {
      return this.handleWebSocketUpgrade(request);
    }
    if (url.pathname === "/create" && request.method === "POST") {
      return this.handleCreate(request);
    }
    if (url.pathname === "/event" && request.method === "POST") {
      return this.handleEvent(request);
    }
    if (url.pathname === "/state" && request.method === "GET") {
      return this.jsonResponse(this.match);
    }
    return new Response("Not found", { status: 404 });
  }

  private handleWebSocketUpgrade(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const voterId = new URL(request.url).searchParams.get("voterId");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sessions.add(server);
    if (voterId) {
      this.voterIds.set(server, voterId);
    }

    if (this.match) {
      const message: ServerMessage = {
        type: "state",
        state: this.match,
        serverTime: Date.now(),
      };
      server.send(JSON.stringify(message));
    }

    server.addEventListener("message", (event) => {
      void this.handleClientMessage(server, event.data);
    });
    server.addEventListener("close", () => {
      this.sessions.delete(server);
      this.voterIds.delete(server);
    });
    server.addEventListener("error", () => {
      this.sessions.delete(server);
      this.voterIds.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleClientMessage(
    ws: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      this.sendError(ws, "invalid JSON message");
      return;
    }
    if (message.type !== "event") {
      this.sendError(ws, `unknown message type: ${(message as { type?: string }).type}`);
      return;
    }
    if (!this.match) {
      this.sendError(ws, "match not created yet");
      return;
    }
    if (message.event.type === "AUDIENCE_VOTE_CAST") {
      await this.handleAudienceVoteCast(ws, message.event.team);
      return;
    }
    try {
      const next = transition(this.match, message.event, Date.now());
      await this.save(next);
    } catch (err) {
      this.sendError(ws, err instanceof IllegalTransitionError ? err.message : "unexpected error");
    }
  }

  /**
   * 観客の1票。voterId必須。同一ラウンド内であれば票の変更（再選択）を許容し、
   * 旧選択を取り消して新選択に付け替える。
   */
  private async handleAudienceVoteCast(ws: WebSocket, team: TeamId): Promise<void> {
    if (!this.match) return;
    const voterId = this.voterIds.get(ws);
    if (!voterId) {
      this.sendVoteAck(ws, false, "voterId is required to vote");
      return;
    }
    const previous = this.votedTeamByVoter.get(voterId);
    const previousTeam =
      previous && previous.round === this.match.votingRoundId ? previous.team : undefined;
    try {
      const next = transition(
        this.match,
        { type: "AUDIENCE_VOTE_CAST", team, previousTeam },
        Date.now(),
      );
      await this.save(next);
      // dedup記録はtransition成功後に行う。失敗時に投票権を失わせないため。
      this.votedTeamByVoter.set(voterId, { round: next.votingRoundId, team });
      this.sendVoteAck(ws, true);
    } catch (err) {
      this.sendVoteAck(
        ws,
        false,
        err instanceof IllegalTransitionError ? err.message : "unexpected error",
      );
    }
  }

  private sendError(ws: WebSocket, msg: string): void {
    const message: ServerMessage = { type: "error", message: msg };
    ws.send(JSON.stringify(message));
  }

  private sendVoteAck(ws: WebSocket, accepted: boolean, reason?: string): void {
    const message: ServerMessage = reason
      ? { type: "vote_ack", accepted, reason }
      : { type: "vote_ack", accepted };
    ws.send(JSON.stringify(message));
  }

  private async handleCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as CreateMatchRequest;
    try {
      const match = createMatch(body.config, body.red, body.blue, body.topic);
      await this.save(match);
      return this.jsonResponse(match);
    } catch (err) {
      return this.errorResponse(err);
    }
  }

  private async handleEvent(request: Request): Promise<Response> {
    if (!this.match) {
      return this.errorResponse(new Error("match not created yet"), 404);
    }
    const message = (await request.json()) as ClientMessage;
    try {
      const next = transition(this.match, message.event, Date.now());
      await this.save(next);
      return this.jsonResponse(next);
    } catch (err) {
      return this.errorResponse(err);
    }
  }

  async alarm(): Promise<void> {
    await this.load();
    if (!this.match) return;
    const next = checkArrival(this.match, Date.now());
    if (next !== this.match) {
      await this.save(next);
    } else {
      // 端に未到達なら次の到達予定時刻へアラームを再設定する
      await this.syncAlarm(this.match);
    }
  }

  private jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  private errorResponse(err: unknown, status = 400): Response {
    const message = err instanceof Error ? err.message : "unexpected error";
    return this.jsonResponse({ error: message }, status);
  }
}
